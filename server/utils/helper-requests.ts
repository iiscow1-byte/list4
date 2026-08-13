import type { DatabaseSync } from 'node:sqlite'
import type { Account } from './auth'
import { logActivity } from './activity-log'

/**
 * What a list helper has asked an admin to do.
 *
 * A helper places new levels and decides submissions and records directly —
 * that is the job, and making them ask permission for it would make the role
 * pointless. Two things are not the job:
 *
 *  - **Moving a level that is already placed.** The placement is a judgement
 *    somebody already made; changing it rewrites the list's own history and
 *    shifts every level it passes.
 *  - **Changing whether a level is a challenge.** That moves it between two
 *    rankings and changes what it is worth on both.
 *
 * Both are reversible only by somebody noticing, which is the test for whether
 * an action should be a request. So a helper files one of these and an admin
 * applies or refuses it.
 *
 * Everything here is also written to the activity log, so the log remains one
 * complete account of what happened rather than one that omits the requests.
 */

export type HelperRequestKind = 'move' | 'challenge' | 'unchallenge' | 'remove'

export type HelperRequestRow = {
  id: number
  kind: HelperRequestKind
  level_id: number | null
  level_name: string
  level_position: number | null
  to_position: number | null
  reason: string | null
  requested_by: number | null
  requester_name: string | null
  status: 'pending' | 'applied' | 'rejected'
  decided_by: number | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

const KIND_SUMMARY: Record<HelperRequestKind, string> = {
  move: 'Requested a move',
  challenge: 'Requested to mark as a challenge',
  unchallenge: 'Requested to unmark as a challenge',
  remove: 'Requested removal from the list',
}

/**
 * File a request.
 *
 * The level's name and position are copied in rather than joined at read time:
 * a request that outlives its level should still say what it was about, and a
 * request to *move* a level is meaningless once you can no longer see where it
 * was when the request was made.
 */
export function fileHelperRequest(
  db: DatabaseSync,
  input: {
    kind: HelperRequestKind
    level: { id: number; name: string; position: number | null }
    toPosition?: number | null
    reason?: string | null
    by: Account
  },
): HelperRequestRow {
  const reason = input.reason?.trim().slice(0, 1000) || null
  const info = db.prepare(
    `INSERT INTO helper_requests
       (kind, level_id, level_name, level_position, to_position, reason, requested_by, requester_name)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    input.kind,
    input.level.id,
    input.level.name,
    input.level.position,
    input.toPosition ?? null,
    reason,
    input.by.id,
    input.by.username,
  )

  const id = Number(info.lastInsertRowid)
  logActivity({
    kind: `helper.request.${input.kind}`,
    area: 'levels',
    severity: 'notable',
    actor: input.by,
    subject: { kind: 'level', id: input.level.id, label: input.level.name },
    summary: `${KIND_SUMMARY[input.kind]}${input.toPosition ? ` to #${input.toPosition}` : ''}`,
    detail: { request_id: id, reason, from: input.level.position, to: input.toPosition ?? null },
  }, db)

  return db.prepare(`SELECT * FROM helper_requests WHERE id = ?`).get(id) as HelperRequestRow
}

/**
 * Record an admin's decision.
 *
 * Applying the request is the *caller's* job, not this function's: a move goes
 * through `moveLevel` and a challenge change through the challenge endpoint,
 * both of which do considerably more than write a column. Trying to perform
 * them from here would mean a second copy of each, and the two copies drifting
 * is exactly how a list ends up disagreeing with itself.
 */
export function decideHelperRequest(
  db: DatabaseSync,
  id: number,
  by: Account,
  outcome: 'applied' | 'rejected',
  note?: string | null,
): HelperRequestRow | null {
  const row = db.prepare(`SELECT * FROM helper_requests WHERE id = ?`)
    .get(id) as HelperRequestRow | undefined
  if (!row || row.status !== 'pending') return null

  db.prepare(
    `UPDATE helper_requests
        SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ?
      WHERE id = ?`,
  ).run(outcome, by.id, note?.trim().slice(0, 1000) || null, id)

  logActivity({
    kind: `helper.request.${outcome}`,
    area: 'levels',
    severity: 'notable',
    actor: by,
    subject: { kind: 'level', id: row.level_id, label: row.level_name },
    summary: `${outcome === 'applied' ? 'Applied' : 'Refused'} ${row.requester_name ?? 'a helper'}'s ${row.kind} request`,
    detail: { request_id: id, note: note ?? null, requested_by: row.requester_name },
  }, db)

  return { ...row, status: outcome }
}

/** The queue, newest first. `status` defaults to what still needs a decision. */
export function listHelperRequests(
  db: DatabaseSync,
  opts: { status?: 'pending' | 'applied' | 'rejected' | 'all'; limit?: number } = {},
): HelperRequestRow[] {
  const status = opts.status ?? 'pending'
  const limit = Math.min(300, Math.max(1, opts.limit ?? 100))
  if (status === 'all') {
    return db.prepare(
      `SELECT * FROM helper_requests ORDER BY created_at DESC LIMIT ?`,
    ).all(limit) as HelperRequestRow[]
  }
  return db.prepare(
    `SELECT * FROM helper_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
  ).all(status, limit) as HelperRequestRow[]
}

/** For the badge on the admin tab. */
export function pendingHelperRequestCount(db: DatabaseSync): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM helper_requests WHERE status = 'pending'`,
  ).get() as { n: number }).n
}

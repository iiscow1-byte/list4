import type { DatabaseSync } from 'node:sqlite'
import type { Account } from './auth'
import { logActivity, type ActivityRow } from './activity-log'
import { invalidateChallengeRanks } from './challenge-rank'
import { invalidateChallengeLeaderboard } from '~/server/api/leaderboard/challenges.get'

/**
 * Undoing something from the log.
 *
 * ## Undo is a new action, not an erasure
 *
 * Nothing is deleted or rewritten. Undoing performs the *inverse* action and
 * appends a second entry describing it, and the original is stamped with who
 * undid it and when. A log you can edit is not a log — the whole reason to keep
 * one is that it says what happened even when what happened was a mistake.
 *
 * ## Why only some kinds
 *
 * An action is undoable when its inverse is exact, and most are not:
 *
 * - **A deleted comment** cannot be restored. Re-inserting the text makes a new
 *   row with a new id, so every report and inbox notice pointing at the old one
 *   still points at nothing, and the author's name is now attached to a comment
 *   they did not post at that moment.
 * - **A removed level** cannot be restored from what is kept. `level_removals`
 *   stores what the changelog needs to draw a row — name, placement, tier — and
 *   not the fifty other columns a level has, nor its records, comments or
 *   history, which the delete cascaded away.
 * - **A posted comment or a filed report** are not mistakes to reverse; the
 *   ordinary controls already delete or resolve them.
 *
 * So the registry is deliberately short. Adding a kind means being able to
 * answer "what exactly does putting this back mean", and the ones below have
 * one clean answer each.
 *
 * ## The staleness check
 *
 * Every handler verifies the world still looks the way the entry left it before
 * touching anything. A role changed `user → moderator → admin` has two undoable
 * entries in the log, and undoing the *first* would silently set the role back
 * to `user`, throwing away a later decision nobody asked about. Refusing is the
 * only correct answer: the entry describes a transition that is no longer the
 * most recent one, and its inverse is no longer meaningful.
 */

export type UndoResult = { summary: string; detail?: Record<string, unknown> }

type UndoHandler = {
  /** Shown on the button, and in the confirmation. */
  label: string
  /**
   * Perform the inverse. Throws a `createError` when the change can no longer
   * be undone; returns what to write into the log entry describing the undo.
   */
  run: (db: DatabaseSync, row: ActivityRow, actor: Account) => UndoResult
}

function parseDetail(row: ActivityRow): Record<string, any> {
  if (!row.detail) return {}
  try {
    return JSON.parse(row.detail) as Record<string, any>
  } catch {
    return {}
  }
}

const HANDLERS: Record<string, UndoHandler> = {
  /**
   * Put a role back to what it was.
   *
   * The one action on this site that changes who can change the site, which is
   * why it is logged at `warning` and why being able to take it back without a
   * second admin typing the old role from memory is worth having.
   */
  'account.role': {
    label: 'Restore previous role',
    run(db, row, actor) {
      const { from, to } = parseDetail(row)
      if (typeof from !== 'string' || typeof to !== 'string') {
        throw createError({ statusCode: 422, statusMessage: 'This entry does not record which role to restore.' })
      }
      const id = row.subject_id
      if (!id) throw createError({ statusCode: 422, statusMessage: 'This entry names no account.' })

      const acc = db.prepare(`SELECT id, username, role FROM accounts WHERE id = ?`)
        .get(id) as { id: number; username: string; role: string } | undefined
      if (!acc) throw createError({ statusCode: 404, statusMessage: 'That account no longer exists.' })

      if (acc.role !== to) {
        throw createError({
          statusCode: 409,
          statusMessage: `${acc.username} is now ${acc.role}, not ${to} — this change has already been superseded.`,
        })
      }

      /*
       * An undo is still a role assignment, so it obeys the same ceiling as
       * one. Otherwise the log becomes a way around "you cannot assign a role
       * ranked above your own": a moderator who could never appoint an admin
       * could undo a demotion back into one.
       */
      const RANK: Record<string, number> = {
        user: 0, list_helper: 1, moderator: 2, admin: 3, owner: 4, developer: 4,
      }
      const mine = RANK[actor.role] ?? 0
      if ((RANK[from] ?? 0) > mine || (RANK[to] ?? 0) > mine) {
        throw createError({ statusCode: 403, statusMessage: 'That role is ranked above your own.' })
      }

      db.prepare(`UPDATE accounts SET role = ? WHERE id = ?`).run(from, acc.id)
      return {
        summary: `Undid a role change — ${acc.username} is ${from} again`,
        detail: { account: acc.username, from: to, to: from, undo_of: row.id },
      }
    },
  },

  'level.challenge.mark': {
    label: 'Unmark as challenge',
    run: (db, row, actor) => undoChallenge(db, row, actor, false),
  },
  'level.challenge.unmark': {
    label: 'Mark as challenge again',
    run: (db, row, actor) => undoChallenge(db, row, actor, true),
  },
}

/**
 * Both challenge entries, inverted.
 *
 * `force_challenge` and `not_challenge` are the two pins an admin can set over
 * the automatic rule — see the challenge expression — and they are mutually
 * exclusive, so restoring means clearing both and setting at most one.
 */
function undoChallenge(
  db: DatabaseSync,
  row: ActivityRow,
  _actor: Account,
  challenge: boolean,
): UndoResult {
  const id = row.subject_id
  if (!id) throw createError({ statusCode: 422, statusMessage: 'This entry names no level.' })

  const lvl = db.prepare(
    `SELECT id, name, position, force_challenge, not_challenge FROM levels WHERE id = ?`,
  ).get(id) as
    | { id: number; name: string; position: number; force_challenge: number | null; not_challenge: number | null }
    | undefined
  if (!lvl) throw createError({ statusCode: 404, statusMessage: 'That level is no longer on the list.' })

  // The pin the original action set must still be the one in place.
  const expected = challenge ? lvl.not_challenge : lvl.force_challenge
  if (!expected) {
    throw createError({
      statusCode: 409,
      statusMessage: `${lvl.name}'s challenge status has changed since — this change has already been superseded.`,
    })
  }

  db.prepare(
    `UPDATE levels SET force_challenge = ?, not_challenge = ? WHERE id = ?`,
  ).run(challenge ? 1 : 0, challenge ? 0 : 1, lvl.id)

  // Same two caches the original action invalidates. An undo that leaves the
  // challenge ranking showing the state it just reversed is not an undo.
  invalidateChallengeRanks()
  invalidateChallengeLeaderboard()

  return {
    summary: challenge
      ? `Undid unmarking ${lvl.name} — it is a challenge again`
      : `Undid marking ${lvl.name} as a challenge`,
    detail: { level: lvl.name, position: lvl.position, challenge, undo_of: row.id },
  }
}

/** Whether this entry offers an Undo, and what the button should say. */
export function undoLabel(row: Pick<ActivityRow, 'kind'>): string | null {
  return HANDLERS[row.kind]?.label ?? null
}

/**
 * Undo one entry.
 *
 * Not wrapped in a transaction: each handler is a single `UPDATE`, and the
 * stamp and the new log entry that follow must survive independently — an undo
 * that happened but wasn't recorded is recoverable, one recorded but not
 * performed is a lie.
 */
export function undoActivity(db: DatabaseSync, entryId: number, actor: Account): UndoResult {
  const row = db.prepare(`SELECT * FROM activity_log WHERE id = ?`).get(entryId) as ActivityRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No such log entry.' })

  const handler = HANDLERS[row.kind]
  if (!handler) {
    throw createError({ statusCode: 422, statusMessage: 'This kind of change cannot be undone.' })
  }
  if ((row as any).undone_at) {
    throw createError({
      statusCode: 409,
      statusMessage: `Already undone by ${(row as any).undone_by_name ?? 'someone'}.`,
    })
  }

  const result = handler.run(db, row, actor)

  db.prepare(
    `UPDATE activity_log SET undone_at = datetime('now'), undone_by = ?, undone_by_name = ?
      WHERE id = ? AND undone_at IS NULL`,
  ).run(actor.id, actor.username, row.id)

  logActivity({
    kind: `${row.kind}.undo`,
    area: row.area,
    // An undo is always worth noticing: it means somebody decided a recorded
    // action was wrong.
    severity: 'warning',
    actor,
    subject: { kind: row.subject_kind ?? 'log', id: row.subject_id, label: row.subject_label },
    summary: result.summary,
    detail: result.detail ?? null,
  }, db)

  return result
}

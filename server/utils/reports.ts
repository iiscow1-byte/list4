import type { DatabaseSync } from 'node:sqlite'
import type { Account, Role } from './auth'
import { isAdminRole } from './auth'
import { logActivity } from './activity-log'

/**
 * Reports, and who is allowed to see them.
 *
 * One table for every kind of report — see the schema — because a report is the
 * same object whatever it points at, and five queues would be five places to
 * forget to look.
 *
 * ## The part that matters
 *
 * `staff_abuse` is in the same vocabulary as the rest, on purpose. A list
 * helper can place levels and act on submissions and records; that is real
 * power over other people's work, and a role with real power needs a way to be
 * complained about that does not run through the person being complained
 * about.
 *
 * So the visibility rule is not "staff see reports". It is:
 *
 *   - an ordinary report is visible to moderators and admins;
 *   - a `staff_abuse` report is visible to **admins only**, and never to the
 *     account it names, whatever role they hold.
 *
 * That second clause is enforced in SQL (`visibleReportsClause`) rather than by
 * filtering afterwards, so a page that forgets to filter shows nothing rather
 * than everything. A moderator reported for abuse cannot see, resolve, or
 * count the report against them.
 */

export const REPORT_TARGETS = [
  'account', 'comment', 'custom_list', 'level', 'forum_thread', 'forum_post',
] as const
export type ReportTarget = typeof REPORT_TARGETS[number]

export const REPORT_REASONS = [
  'spam', 'abuse', 'impersonation', 'inappropriate',
  'wrong_placement', 'impossible', 'removal_request',
  'staff_abuse', 'other',
] as const
export type ReportReason = typeof REPORT_REASONS[number]

/** Which reasons make sense for which target, and what each one is called. */
export const REASONS_BY_TARGET: Record<ReportTarget, ReportReason[]> = {
  account: ['abuse', 'impersonation', 'spam', 'inappropriate', 'staff_abuse', 'other'],
  comment: ['abuse', 'spam', 'inappropriate', 'other'],
  custom_list: ['inappropriate', 'spam', 'impersonation', 'other'],
  // The two the list itself acts on. "Impossible" is its own reason rather than
  // a note on a removal request: they lead to different checks — one is a
  // verification question, the other is an editorial one — and collapsing them
  // would make the queue impossible to triage.
  level: ['impossible', 'removal_request', 'wrong_placement', 'inappropriate', 'other'],
  forum_thread: ['abuse', 'spam', 'inappropriate', 'other'],
  forum_post: ['abuse', 'spam', 'inappropriate', 'other'],
}

export const REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  abuse: 'Abuse or harassment',
  impersonation: 'Impersonation',
  inappropriate: 'Inappropriate content',
  wrong_placement: 'Wrong placement',
  impossible: 'Level is impossible',
  removal_request: 'Should be removed from the list',
  staff_abuse: 'Staff abusing their role',
  other: 'Something else',
}

/** Reports only an admin may read. Kept as a set so the rule has one home. */
const ADMIN_ONLY_REASONS = new Set<ReportReason>(['staff_abuse'])

export function isAdminOnlyReason(reason: string): boolean {
  return ADMIN_ONLY_REASONS.has(reason as ReportReason)
}

/**
 * Whether this account may act on the report queue at all.
 *
 * Helpers may not. They are trusted with the list's contents, not with people —
 * and a helper who could resolve reports could resolve the ones about
 * themselves.
 */
export function canReviewReports(role: Role): boolean {
  return role === 'moderator' || isAdminRole(role)
}

/**
 * The SQL that limits a viewer to the reports they may see, as a clause and its
 * parameters.
 *
 * Written as SQL rather than a filter applied to the results because those two
 * fail differently. A forgotten `.filter()` shows every report to everyone; a
 * forgotten clause here shows none, and somebody notices immediately.
 *
 * Two rules, both about `staff_abuse`:
 *  1. Only admins see it at all.
 *  2. Nobody sees one that names them — including an admin. An admin reported
 *     for abuse should be reviewed by a different admin, and the site should
 *     not be the thing that tells them it exists.
 */
export function visibleReportsClause(viewer: Account): { sql: string; params: unknown[] } {
  if (!isAdminRole(viewer.role)) {
    // Moderators: everything except the staff-abuse reports.
    return { sql: `reason NOT IN ('staff_abuse')`, params: [] }
  }
  return {
    sql: `NOT (reason = 'staff_abuse'
               AND target_kind = 'account'
               AND target_id = ?)`,
    params: [viewer.id],
  }
}

export type ReportRow = {
  id: number
  target_kind: ReportTarget
  target_id: number
  target_label: string | null
  reason: ReportReason
  details: string | null
  reporter_id: number | null
  reporter_name: string | null
  status: 'open' | 'actioned' | 'dismissed'
  resolution: string | null
  resolved_by: number | null
  resolved_at: string | null
  created_at: string
}

/**
 * File a report.
 *
 * Returns `duplicate` rather than throwing when the same person has an open
 * report on the same thing: the unique index makes that a constraint error, and
 * "you already reported this" is an answer, not a failure. Filing one is
 * logged, because a flood of reports from one account is itself something a
 * moderator needs to be able to see.
 */
export function fileReport(
  db: DatabaseSync,
  input: {
    target: ReportTarget
    targetId: number
    targetLabel?: string | null
    reason: ReportReason
    details?: string | null
    reporter: Account
  },
): { ok: true; id: number } | { ok: false; duplicate: true } {
  const details = input.details?.trim().slice(0, 2000) || null
  try {
    const info = db.prepare(
      `INSERT INTO reports
         (target_kind, target_id, target_label, reason, details, reporter_id, reporter_name)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      input.target,
      input.targetId,
      input.targetLabel?.slice(0, 300) ?? null,
      input.reason,
      details,
      input.reporter.id,
      input.reporter.username,
    )

    const id = Number(info.lastInsertRowid)
    logActivity({
      kind: 'report.file',
      area: 'reports',
      // A report about staff is the one kind that must not sit in a list of
      // routine events waiting to be scrolled past.
      severity: input.reason === 'staff_abuse' ? 'warning' : 'notable',
      actor: input.reporter,
      subject: { kind: input.target, id: input.targetId, label: input.targetLabel ?? null },
      summary: `Reported ${input.target.replace('_', ' ')}: ${REASON_LABELS[input.reason]}`,
      detail: { report_id: id, reason: input.reason, details },
    }, db)

    return { ok: true, id }
  } catch (err: unknown) {
    // The partial unique index on (target, id, reporter) WHERE status='open'.
    if (String((err as Error)?.message ?? '').includes('UNIQUE')) {
      return { ok: false, duplicate: true }
    }
    throw err
  }
}

/** Close a report, one way or the other. */
export function resolveReport(
  db: DatabaseSync,
  id: number,
  by: Account,
  outcome: 'actioned' | 'dismissed',
  note?: string | null,
): ReportRow | null {
  const row = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as ReportRow | undefined
  if (!row) return null

  db.prepare(
    `UPDATE reports
        SET status = ?, resolution = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE id = ?`,
  ).run(outcome, note?.trim().slice(0, 1000) || null, by.id, id)

  logActivity({
    kind: `report.${outcome}`,
    area: 'reports',
    severity: row.reason === 'staff_abuse' ? 'warning' : 'notable',
    actor: by,
    subject: { kind: row.target_kind, id: row.target_id, label: row.target_label },
    summary: `${outcome === 'actioned' ? 'Actioned' : 'Dismissed'} report: ${REASON_LABELS[row.reason]}`,
    detail: { report_id: id, reason: row.reason, note: note ?? null },
  }, db)

  return { ...row, status: outcome }
}

/**
 * How many open reports this viewer can see.
 *
 * Used for the badge on the admin tab. Goes through the same visibility clause
 * as the queue itself — a badge counting reports the page then refuses to show
 * is how somebody finds out a report about them exists.
 */
export function openReportCount(db: DatabaseSync, viewer: Account): number {
  if (!canReviewReports(viewer.role)) return 0
  const { sql, params } = visibleReportsClause(viewer)
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM reports WHERE status = 'open' AND (${sql})`,
  ).get(...params as never[]) as { n: number }).n
}

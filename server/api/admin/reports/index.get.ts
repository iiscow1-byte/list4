import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import {
  canReviewReports, visibleReportsClause, REASON_LABELS, type ReportRow,
} from '~/server/utils/reports'

/**
 * The report queue.
 *
 * Moderators and admins. A list helper is deliberately not here: their role is
 * the list's contents, not the site's people, and a helper who could resolve
 * reports could resolve the ones about themselves.
 *
 * Visibility goes through `visibleReportsClause`, in SQL. Two rules, both about
 * `staff_abuse`: only admins see one at all, and nobody sees one that names
 * them — including an admin. That second rule is why this is a WHERE clause and
 * not a filter applied to the results: a forgotten filter shows everything to
 * everyone, whereas a forgotten clause shows nothing and gets noticed.
 */
export default defineEventHandler((event) => {
  const account = requireMod(event)
  if (!canReviewReports(account.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Moderators or admins only.' })
  }

  const db = getDb()
  const q = getQuery(event)
  const status = q.status === 'actioned' || q.status === 'dismissed' || q.status === 'all'
    ? q.status
    : 'open'

  const { sql: visible, params: visibleParams } = visibleReportsClause(account)
  const where: string[] = [`(${visible})`]
  const params: unknown[] = [...visibleParams]

  if (status !== 'all') { where.push(`status = ?`); params.push(status) }
  if (typeof q.target === 'string' && q.target) { where.push(`target_kind = ?`); params.push(q.target) }
  if (typeof q.reason === 'string' && q.reason) { where.push(`reason = ?`); params.push(q.reason) }

  const clause = `WHERE ${where.join(' AND ')}`
  const items = db.prepare(
    `SELECT * FROM reports ${clause} ORDER BY
       -- Anything still open first, then newest. A queue sorted purely by date
       -- buries the one open report under a month of resolved ones.
       CASE status WHEN 'open' THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 200`,
  ).all(...params as never[]) as ReportRow[]

  /** Counts per status, for the tab labels — same visibility rule. */
  const counts = db.prepare(
    `SELECT status, COUNT(*) AS n FROM reports WHERE (${visible}) GROUP BY status`,
  ).all(...visibleParams as never[]) as { status: string; n: number }[]

  return {
    items,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    reasonLabels: REASON_LABELS,
    isAdmin: account.role !== 'moderator',
  }
})

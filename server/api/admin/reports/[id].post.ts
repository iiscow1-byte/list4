import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import {
  canReviewReports, resolveReport, visibleReportsClause,
} from '~/server/utils/reports'

/**
 * Close one report.
 *
 * The visibility rule is re-applied here rather than trusted from the list.
 * The queue endpoint hides a `staff_abuse` report from the person it names, but
 * the id is a small integer and guessable — without this check, an admin who
 * suspected a report existed about them could close it by trying numbers.
 * Answering 404 rather than 403 is deliberate for the same reason: 403 would
 * confirm the report exists.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  if (!canReviewReports(account.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Moderators or admins only.' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad report id.' })
  }

  const body = await readBody<{ action?: unknown; note?: unknown }>(event) ?? {}
  const outcome = body.action === 'action' ? 'actioned'
    : body.action === 'dismiss' ? 'dismissed'
      : null
  if (!outcome) {
    throw createError({ statusCode: 400, statusMessage: '`action` must be action or dismiss.' })
  }

  const db = getDb()
  const { sql: visible, params } = visibleReportsClause(account)
  const allowed = db.prepare(
    `SELECT id FROM reports WHERE id = ? AND (${visible})`,
  ).get(id, ...params as never[])
  if (!allowed) throw createError({ statusCode: 404, statusMessage: 'No such report.' })

  const row = resolveReport(db, id, account, outcome, typeof body.note === 'string' ? body.note : null)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No such report.' })

  return { ok: true, report: row }
})

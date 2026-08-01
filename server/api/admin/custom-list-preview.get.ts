import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { buildLevelSliceWhere } from '~/server/utils/level-slice'

/**
 * How many levels the current "create a custom list" filters would pull in,
 * plus the first few names. Uses the same WHERE builder as the create
 * endpoint, so the preview can't promise a different set than it produces.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const { where, params } = buildLevelSliceWhere({
    from_position: q.from_position != null ? Number(q.from_position) : null,
    to_position: q.to_position != null ? Number(q.to_position) : null,
    tier: q.tier ? String(q.tier) : null,
    rated: q.rated ? String(q.rated) : null,
  })

  const db = getDb()
  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM levels ${where}`,
  ).get(...params) as { n: number }).n

  const sample = db.prepare(
    `SELECT position, sheet_placement, name FROM levels ${where} ORDER BY position ASC LIMIT 5`,
  ).all(...params)

  return { total, sample }
})

import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

/**
 * Delete all position_history rows for a given level on a given UTC date.
 * This removes that level's condensed changelog entry for the day.
 */
export default defineEventHandler((event) => {
  requireMod(event)
  const levelId = Number(getRouterParam(event, 'levelId'))
  if (!Number.isInteger(levelId) || levelId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid levelId' })
  }
  const q = getQuery(event)
  const date = String(q.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, statusMessage: 'date must be YYYY-MM-DD' })
  }

  const db = getDb()
  const since = `${date} 00:00:00`
  const until = `${date} 23:59:59`
  db.prepare(
    `DELETE FROM position_history WHERE level_id = ? AND changed_at >= ? AND changed_at <= ?`,
  ).run(levelId, since, until)

  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Delete a void-list level and shift everything below it up by one to close
 * the gap. Admin only — destructive.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad position.' })
  }

  const db = getDb()
  const existing = db.prepare(`SELECT id FROM void_levels WHERE position = ?`).get(position) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such void level.' })

  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM void_levels WHERE position = ?`).run(position)
    db.prepare(`UPDATE void_levels SET position = -(position - 1) WHERE position > ?`).run(position)
    db.prepare(`UPDATE void_levels SET position = -position WHERE position < 0`).run()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  const db = getDb()
  const existing = db.prepare(`SELECT id FROM position_history WHERE id = ?`).get(id) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Entry not found.' })
  db.prepare(`DELETE FROM position_history WHERE id = ?`).run(id)
  return { ok: true }
})

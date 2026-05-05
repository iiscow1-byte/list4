import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const db = getDb()
  const rec = db.prepare(`SELECT id FROM records WHERE id = ? AND permanent = 1`).get(id)
  if (!rec) throw createError({ statusCode: 404, statusMessage: 'No approved record with that id.' })

  db.prepare(`DELETE FROM records WHERE id = ?`).run(id)
  return { ok: true }
})

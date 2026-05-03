import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Delete an open-verification entirely. Admin only — destructive.
 * (Distinct from the approve/reject flow which sets status; this drops the row.)
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }

  const db = getDb()
  const existing = db.prepare(`SELECT id FROM open_verifications WHERE id = ?`).get(id) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such open verification.' })

  db.prepare(`DELETE FROM open_verifications WHERE id = ?`).run(id)

  return { ok: true }
})

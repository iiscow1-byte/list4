import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Promote a sheet-imported temporary level to a permanent (website-owned) one.
 * Future re-imports skip its gd_id so admin edits aren't overwritten.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position)) throw createError({ statusCode: 400, statusMessage: 'Bad position' })

  const db = getDb()
  const level = db.prepare(`SELECT permanent FROM levels WHERE position = ?`).get(position) as { permanent: number } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })
  if (level.permanent) throw createError({ statusCode: 409, statusMessage: 'Level is already permanent.' })

  db.prepare(`UPDATE levels SET permanent = 1 WHERE position = ?`).run(position)
  return { ok: true }
})

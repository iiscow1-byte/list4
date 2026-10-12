import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { SHEET_FIELDS, addSiteFields } from '~/server/utils/list-ops'

/**
 * Keep every sheet column of this level as it is now, ignoring the sheet's
 * values from here on. (This used to be required before a level could be
 * edited; it no longer is, and placement is never frozen by it.)
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position)) throw createError({ statusCode: 400, statusMessage: 'Bad position' })
  const db = getDb()
  const level = db.prepare(`SELECT id FROM levels WHERE position = ?`).get(position) as { id: number } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })
  addSiteFields(db, level.id, [...SHEET_FIELDS])
  return { ok: true }
})

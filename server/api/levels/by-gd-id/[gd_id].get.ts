import { getDb } from '~/server/db'

/**
 * Resolve a GD level ID to its list position. Used by the search box to
 * jump straight to the level page when the user pastes/types a gd_id.
 */
export default defineEventHandler((event) => {
  const gdId = Number(getRouterParam(event, 'gd_id'))
  if (!Number.isInteger(gdId) || gdId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid gd_id.' })
  }

  const db = getDb()
  const row = db
    .prepare(`SELECT position, name FROM levels WHERE gd_id = ? LIMIT 1`)
    .get(gdId) as { position: number; name: string } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not found.' })

  return row
})

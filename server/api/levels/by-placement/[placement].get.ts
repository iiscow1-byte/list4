import { getDb } from '~/server/db'

/**
 * The level at a printed placement (`#N`). Placements are positions, so this
 * is exact; past the end of the list it returns the last level.
 */
export default defineEventHandler((event) => {
  const placement = Number(getRouterParam(event, 'placement'))
  if (!Number.isInteger(placement) || placement <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid placement.' })
  }
  const db = getDb()
  const row = db.prepare(
    `SELECT position, name FROM levels WHERE position <= ? ORDER BY position DESC LIMIT 1`,
  ).get(placement) as { position: number; name: string } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  return { ...row, sheet_placement: row.position, exact: row.position === placement }
})

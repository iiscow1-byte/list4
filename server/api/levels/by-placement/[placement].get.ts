import { getDb } from '~/server/db'

/**
 * Resolve a *sheet* placement (the "#N" the UI displays) to the internal list
 * position that URLs are keyed on. Used by the search box's "#N" shortcut.
 *
 * Sheet placements drift from positions because levels appearing on multiple
 * sheet tabs collapse into one row, so an exact match can miss — e.g. the row
 * that held #13051 was deduped away. In that case we fall back to the nearest
 * placement at or below the requested one, which lands the user in the right
 * neighbourhood rather than erroring.
 */
export default defineEventHandler((event) => {
  const placement = Number(getRouterParam(event, 'placement'))
  if (!Number.isInteger(placement) || placement <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid placement.' })
  }

  const db = getDb()
  const exact = db
    .prepare(`SELECT position, name, sheet_placement FROM levels WHERE sheet_placement = ? LIMIT 1`)
    .get(placement) as { position: number; name: string; sheet_placement: number } | undefined
  if (exact) return { ...exact, exact: true }

  const near = db
    .prepare(
      `SELECT position, name, sheet_placement FROM levels
        WHERE sheet_placement IS NOT NULL AND sheet_placement <= ?
        ORDER BY sheet_placement DESC LIMIT 1`,
    )
    .get(placement) as { position: number; name: string; sheet_placement: number } | undefined
  if (near) return { ...near, exact: false }

  throw createError({ statusCode: 404, statusMessage: 'Not found.' })
})

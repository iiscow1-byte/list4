import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { moveLevel } from '~/server/utils/move-level'

/**
 * Move a level from `position` to `body.to`. Other affected rows in the range
 * shift by one to fill / make room; `moveLevel` owns that part, shared with the
 * other endpoints that move levels.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const fromPos = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(fromPos) || fromPos <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad source position.' })
  }
  const body = await readBody<{ to?: number; to_placement?: number }>(event) ?? {}
  const db = getDb()

  // The UI shows the sheet's placement numbers, not internal positions — the
  // two drift apart because levels appearing on several sheet tabs collapse
  // into one row. `to_placement` is what an admin actually typed; resolve it
  // to the position of whichever level currently sits at that placement, so
  // "move to #4200" lands where #4200 is on screen rather than 10 rows away.
  let toPos: number
  const wantedPlacement = Number(body.to_placement)
  if (Number.isInteger(wantedPlacement) && wantedPlacement > 0) {
    const exact = db.prepare(
      `SELECT position FROM levels WHERE sheet_placement = ? LIMIT 1`,
    ).get(wantedPlacement) as { position: number } | undefined
    const near = exact ?? db.prepare(
      `SELECT position FROM levels
        WHERE sheet_placement IS NOT NULL AND sheet_placement <= ?
        ORDER BY sheet_placement DESC LIMIT 1`,
    ).get(wantedPlacement) as { position: number } | undefined
    if (!near) {
      throw createError({ statusCode: 400, statusMessage: 'No level sits at that placement.' })
    }
    toPos = near.position
  } else {
    toPos = Number(body.to)
  }

  if (!Number.isInteger(toPos) || toPos <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A target position is required.' })
  }
  if (fromPos === toPos) return { ok: true, moved: 0 }

  let result
  try {
    result = moveLevel(db, fromPos, toPos, account.id)
  } catch (e: any) {
    throw createError({ statusCode: 404, statusMessage: e?.message ?? 'No such level.' })
  }

  // Tier midpoints shift whenever a level moves across tier boundaries, so
  // recompute points across the whole list after the structural change.
  if (result.moved) recomputePoints(db)

  return { ok: true, from: result.from, to: result.to }
})

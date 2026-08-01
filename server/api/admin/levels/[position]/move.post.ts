import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { resyncPlacementsForMove } from '~/server/utils/placement-sync'

/**
 * Move a level from `position` to `body.to`. Other affected rows in the range
 * shift by one to fill / make room. Done with a far-negative stash + the
 * negate-then-flip pattern so SQLite's UNIQUE constraint on `position` doesn't
 * trip mid-update.
 */
const STASH = -1_000_000_000

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
  const existing = db.prepare(`SELECT id FROM levels WHERE position = ?`).get(fromPos) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such level.' })
  const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
  const target = Math.min(toPos, maxPos)

  db.exec('BEGIN')
  try {
    // 1. Stash the row being moved out of range so it can't collide.
    db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(STASH, fromPos)

    // 2. Shift the affected range using negate-then-flip.
    if (target < fromPos) {
      // Moving UP — rows in [target, fromPos-1] shift DOWN by one.
      db.prepare(
        `UPDATE levels SET position = -(position + 1) WHERE position >= ? AND position < ?`,
      ).run(target, fromPos)
    } else {
      // Moving DOWN — rows in [fromPos+1, target] shift UP by one.
      db.prepare(
        `UPDATE levels SET position = -(position - 1) WHERE position > ? AND position <= ?`,
      ).run(fromPos, target)
    }
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0 AND position != ?`).run(STASH)

    // 3. Place the moved row at its new position and clear the tentative flag —
    //    a deliberate position change means placement is no longer uncertain.
    db.prepare(`UPDATE levels SET position = ?, tentative_placement = 0 WHERE position = ?`).run(target, STASH)

    // 4. Placement numbers belong to slots, not to levels. Without this the
    //    moved row keeps printing the number it arrived with — which is the
    //    "the placement is still the same after I move a level" bug — and every
    //    row it displaced prints its neighbour's.
    resyncPlacementsForMove(db, fromPos, target)

    // If this level was already moved today (UTC), update the original entry's
    // to_position so the changelog shows one condensed #X → #Y, not N hops.
    const existingToday = db.prepare(
      `SELECT id FROM position_history
       WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now')
       ORDER BY changed_at ASC, id ASC LIMIT 1`,
    ).get(existing.id) as { id: number } | undefined
    if (existingToday) {
      db.prepare(`UPDATE position_history SET to_position = ?, changed_at = datetime('now'), changed_by = ? WHERE id = ?`)
        .run(target, account.id, existingToday.id)
      db.prepare(`DELETE FROM position_history WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now') AND id != ?`)
        .run(existing.id, existingToday.id)
    } else {
      db.prepare(
        `INSERT INTO position_history (level_id, from_position, to_position, changed_by)
         VALUES (?, ?, ?, ?)`,
      ).run(existing.id, fromPos, target, account.id)
    }

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  // Tier midpoints shift whenever a level moves across tier boundaries, so
  // recompute points across the whole list after the structural change.
  recomputePoints(db)

  return { ok: true, from: fromPos, to: target }
})

import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'

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
  const body = await readBody<{ to?: number }>(event) ?? {}
  const toPos = Number(body.to)
  if (!Number.isInteger(toPos) || toPos <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A target position is required.' })
  }
  if (fromPos === toPos) return { ok: true, moved: 0 }

  const db = getDb()
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

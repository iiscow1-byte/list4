import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

/**
 * Move a level from `position` to `body.to`. Other affected rows in the range
 * shift by one to fill / make room. Done with a far-negative stash + the
 * negate-then-flip pattern so SQLite's UNIQUE constraint on `position` doesn't
 * trip mid-update.
 */
const STASH = -1_000_000_000

export default defineEventHandler(async (event) => {
  requireMod(event)
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

    // 3. Place the moved row at its new position.
    db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(target, STASH)

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { ok: true, from: fromPos, to: target }
})

import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

/**
 * Move a void-list level from `position` to `body.to`. Other affected rows in
 * the range shift by one to fill / make room. Same negate-then-flip trick used
 * on the main list to dodge UNIQUE collisions mid-update.
 */
const STASH = -1_000_000_000

export default defineEventHandler(async (event) => {
  requireMod(event)
  const fromPos = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(fromPos) || fromPos <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad source position.' })
  }
  const body = (await readBody<{ to?: number }>(event)) ?? {}
  const toPos = Number(body.to)
  if (!Number.isInteger(toPos) || toPos <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A target position is required.' })
  }
  if (fromPos === toPos) return { ok: true, moved: 0 }

  const db = getDb()
  const existing = db.prepare(`SELECT id FROM void_levels WHERE position = ?`).get(fromPos) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such void level.' })
  const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM void_levels`).get() as { m: number | null }).m ?? 0
  const target = Math.min(toPos, maxPos)

  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE void_levels SET position = ? WHERE position = ?`).run(STASH, fromPos)
    if (target < fromPos) {
      db.prepare(
        `UPDATE void_levels SET position = -(position + 1) WHERE position >= ? AND position < ?`,
      ).run(target, fromPos)
    } else {
      db.prepare(
        `UPDATE void_levels SET position = -(position - 1) WHERE position > ? AND position <= ?`,
      ).run(fromPos, target)
    }
    db.prepare(`UPDATE void_levels SET position = -position WHERE position < 0 AND position != ?`).run(STASH)
    db.prepare(`UPDATE void_levels SET position = ? WHERE position = ?`).run(target, STASH)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { ok: true, from: fromPos, to: target }
})

import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { resyncPlacementsForMove } from '~/server/utils/placement-sync'

const STASH = -1_000_000_000

export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const body = await readBody<{ positions?: unknown; delta?: unknown }>(event) ?? {}

  const positions: number[] = Array.isArray(body.positions)
    ? [...new Set(body.positions.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : []
  if (positions.length === 0) throw createError({ statusCode: 400, statusMessage: 'No valid positions provided.' })

  const delta = Number(body.delta)
  if (!Number.isInteger(delta) || delta === 0) {
    throw createError({ statusCode: 400, statusMessage: 'delta must be a non-zero integer.' })
  }

  const db = getDb()
  const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0

  // Moving down → process highest first so each shift doesn't affect lower picks.
  // Moving up  → process lowest first for the same reason.
  const sorted = positions.sort((a, b) => delta > 0 ? b - a : a - b)

  db.exec('BEGIN')
  let moved = 0
  try {
    for (const fromPos of sorted) {
      const row = db.prepare(`SELECT id FROM levels WHERE position = ?`).get(fromPos) as { id: number } | undefined
      if (!row) continue

      const toPos = Math.min(Math.max(1, fromPos + delta), maxPos)
      if (fromPos === toPos) continue

      db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(STASH, fromPos)

      if (toPos < fromPos) {
        db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ? AND position < ?`).run(toPos, fromPos)
      } else {
        db.prepare(`UPDATE levels SET position = -(position - 1) WHERE position > ? AND position <= ?`).run(fromPos, toPos)
      }
      db.prepare(`UPDATE levels SET position = -position WHERE position < 0 AND position != ?`).run(STASH)
      db.prepare(`UPDATE levels SET position = ?, tentative_placement = 0 WHERE position = ?`).run(toPos, STASH)

      const existingToday = db.prepare(
        `SELECT id FROM position_history
         WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now')
         ORDER BY changed_at ASC, id ASC LIMIT 1`,
      ).get(row.id) as { id: number } | undefined
      if (existingToday) {
        db.prepare(`UPDATE position_history SET to_position = ?, changed_at = datetime('now'), changed_by = ? WHERE id = ?`)
          .run(toPos, account.id, existingToday.id)
        db.prepare(`DELETE FROM position_history WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now') AND id != ?`)
          .run(row.id, existingToday.id)
      } else {
        db.prepare(`INSERT INTO position_history (level_id, from_position, to_position, changed_by) VALUES (?, ?, ?, ?)`)
          .run(row.id, fromPos, toPos, account.id)
      }
      moved++
      // Placement numbers stay with the slot, not the level — see
      // `server/utils/placement-sync.ts`.
      resyncPlacementsForMove(db, fromPos, toPos)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  recomputePoints(db)
  return { ok: true, moved }
})

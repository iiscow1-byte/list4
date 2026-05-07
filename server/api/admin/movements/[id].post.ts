import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'

const STASH = -1_000_000_000

export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id.' })
  }
  const body = await readBody<{ action: 'approve' | 'reject'; reason?: string }>(event)
  if (body.action !== 'approve' && body.action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'action must be approve or reject.' })
  }

  const db = getDb()
  const movement = db.prepare(
    `SELECT * FROM pending_movements WHERE id = ? AND status = 'pending'`,
  ).get(id) as {
    id: number; level_name: string; level_gd_id: number | null
    from_position: number; to_position: number
  } | undefined
  if (!movement) throw createError({ statusCode: 404, statusMessage: 'Movement not found or already decided.' })

  if (body.action === 'reject') {
    db.prepare(
      `UPDATE pending_movements SET status = 'rejected', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    ).run(account.id, id)
    return { ok: true }
  }

  // Resolve the actual current position of the level (gd_id is the stable key).
  let fromPos = movement.from_position
  if (movement.level_gd_id) {
    const row = db.prepare(`SELECT position FROM levels WHERE gd_id = ?`).get(movement.level_gd_id) as { position: number } | undefined
    if (row) fromPos = row.position
  } else {
    const row = db.prepare(`SELECT id FROM levels WHERE position = ?`).get(fromPos) as { id: number } | undefined
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Level no longer exists at the recorded position.' })
  }

  const levelRow = db.prepare(`SELECT id FROM levels WHERE position = ?`).get(fromPos) as { id: number } | undefined
  if (!levelRow) throw createError({ statusCode: 404, statusMessage: 'Level not found at current position.' })

  const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
  const toPos = Math.min(movement.to_position, maxPos)
  if (fromPos === toPos) {
    db.prepare(
      `UPDATE pending_movements SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    ).run(account.id, id)
    return { ok: true, from: fromPos, to: toPos }
  }

  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(STASH, fromPos)
    if (toPos < fromPos) {
      db.prepare(
        `UPDATE levels SET position = -(position + 1) WHERE position >= ? AND position < ?`,
      ).run(toPos, fromPos)
    } else {
      db.prepare(
        `UPDATE levels SET position = -(position - 1) WHERE position > ? AND position <= ?`,
      ).run(fromPos, toPos)
    }
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0 AND position != ?`).run(STASH)
    db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(toPos, STASH)

    const existingToday = db.prepare(
      `SELECT id FROM position_history
       WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now')
       ORDER BY changed_at ASC, id ASC LIMIT 1`,
    ).get(levelRow.id) as { id: number } | undefined
    if (existingToday) {
      db.prepare(`UPDATE position_history SET to_position = ?, changed_at = datetime('now'), changed_by = ? WHERE id = ?`)
        .run(toPos, account.id, existingToday.id)
      db.prepare(`DELETE FROM position_history WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now') AND id != ?`)
        .run(levelRow.id, existingToday.id)
    } else {
      db.prepare(
        `INSERT INTO position_history (level_id, from_position, to_position, changed_by) VALUES (?, ?, ?, ?)`,
      ).run(levelRow.id, fromPos, toPos, account.id)
    }

    db.prepare(
      `UPDATE pending_movements SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
    ).run(account.id, id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  recomputePoints(db)
  return { ok: true, from: fromPos, to: toPos }
})

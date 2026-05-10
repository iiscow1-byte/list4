import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const body = await readBody<Record<string, unknown>>(event)

  const levelName = typeof body.level_name === 'string' ? body.level_name.trim() : ''
  if (!levelName) throw createError({ statusCode: 400, statusMessage: 'Level name is required.' })

  const levelGdId = body.level_gd_id != null && body.level_gd_id !== '' ? Number(body.level_gd_id) : null

  const fromPosition = Number(body.from_position)
  if (!Number.isInteger(fromPosition) || fromPosition <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'from_position must be a positive integer.' })
  }
  const toPosition = Number(body.to_position)
  if (!Number.isInteger(toPosition) || toPosition <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'to_position must be a positive integer.' })
  }
  if (fromPosition === toPosition) {
    throw createError({ statusCode: 400, statusMessage: 'from_position and to_position must differ.' })
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null

  const db = getDb()

  // Replace any existing pending movement for the same level.
  db.prepare(
    `DELETE FROM pending_movements WHERE level_name = ? AND status = 'pending'`,
  ).run(levelName)

  const result = db.prepare(
    `INSERT INTO pending_movements (level_name, level_gd_id, from_position, to_position, notes, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(levelName, levelGdId, fromPosition, toPosition, notes, account.id)

  return { ok: true, id: Number(result.lastInsertRowid) }
})

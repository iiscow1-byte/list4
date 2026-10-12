import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { afterListChange, moveLevel } from '~/server/utils/list-ops'

/** Approve or reject a suggested move. */
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
  const movement = db.prepare(`SELECT * FROM pending_movements WHERE id = ? AND status = 'pending'`).get(id) as {
    id: number; level_name: string; level_gd_id: number | null; from_position: number; to_position: number
  } | undefined
  if (!movement) throw createError({ statusCode: 404, statusMessage: 'Movement not found or already decided.' })

  const decide = (status: string) => db.prepare(
    `UPDATE pending_movements SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
  ).run(status, account.id, id)

  if (body.action === 'reject') {
    decide('rejected')
    return { ok: true }
  }

  // The level may have moved since the suggestion was made; find where it is now.
  let fromPos: number | null = null
  if (movement.level_gd_id) {
    const rows = db.prepare(`SELECT position FROM levels WHERE gd_id = ?`).all(movement.level_gd_id) as { position: number }[]
    if (rows.length === 1) fromPos = rows[0]!.position
  }
  if (fromPos == null) {
    const at = db.prepare(`SELECT position, name FROM levels WHERE position = ?`).get(movement.from_position) as { position: number; name: string } | undefined
    if (at && at.name.toLowerCase() === movement.level_name.toLowerCase()) fromPos = at.position
  }
  if (fromPos == null) throw createError({ statusCode: 404, statusMessage: 'That level is no longer where the suggestion says.' })

  const res = moveLevel(db, fromPos, movement.to_position, account.id)
  decide('approved')
  if (res.moved) afterListChange(db)
  return { ok: true, from: res.from, to: res.to }
})

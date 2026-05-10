import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const body = await readBody<{ positions?: unknown; delta?: unknown; notes?: unknown }>(event) ?? {}

  const positions: number[] = Array.isArray(body.positions)
    ? [...new Set(body.positions.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : []
  if (positions.length === 0) throw createError({ statusCode: 400, statusMessage: 'No valid positions provided.' })

  const delta = Number(body.delta)
  if (!Number.isInteger(delta) || delta === 0) {
    throw createError({ statusCode: 400, statusMessage: 'delta must be a non-zero integer.' })
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null

  const db = getDb()
  const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0

  let submitted = 0
  for (const fromPos of positions) {
    const level = db
      .prepare(`SELECT name, gd_id FROM levels WHERE position = ?`)
      .get(fromPos) as { name: string; gd_id: number | null } | undefined
    if (!level) continue

    const toPos = Math.min(Math.max(1, fromPos + delta), maxPos)
    if (fromPos === toPos) continue

    db.prepare(`DELETE FROM pending_movements WHERE level_name = ? AND status = 'pending'`).run(level.name)
    db.prepare(
      `INSERT INTO pending_movements (level_name, level_gd_id, from_position, to_position, notes, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(level.name, level.gd_id, fromPos, toPos, notes, account.id)
    submitted++
  }

  return { ok: true, submitted }
})

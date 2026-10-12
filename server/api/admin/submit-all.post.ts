import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { afterListChange, moveLevel, tx } from '~/server/utils/list-ops'
import { placeSubmission } from '~/server/utils/place-submission'

/**
 * Place every awaiting level that has a suggested placement, then approve every
 * pending movement. Awaiting levels go in from the bottom up so an earlier
 * insert doesn't shift the slot a later one was aimed at.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const db = getDb()

  const awaitingItems = db.prepare(
    `SELECT * FROM awaiting_levels WHERE placement_suggestion IS NOT NULL ORDER BY placement_suggestion DESC`,
  ).all() as any[]
  const submitterOf = db.prepare(`SELECT submitted_by FROM pending_levels WHERE id = ?`)

  let placed = 0
  for (const sub of awaitingItems) {
    const submittedBy = sub.pending_id
      ? (submitterOf.get(sub.pending_id) as { submitted_by: number | null } | undefined)?.submitted_by ?? null
      : null
    try {
      tx(db, () => {
        placeSubmission(db, sub, sub.placement_suggestion, { actorId: account.id, submittedBy })
        db.prepare(`DELETE FROM awaiting_levels WHERE id = ?`).run(sub.id)
      })
      placed++
    } catch (e) {
      console.warn(`[submit-all] couldn't place "${sub.name}":`, (e as Error).message)
    }
  }

  const movements = db.prepare(
    `SELECT * FROM pending_movements WHERE status = 'pending' ORDER BY submitted_at ASC`,
  ).all() as any[]
  const decide = db.prepare(
    `UPDATE pending_movements SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`,
  )

  let moved = 0
  for (const m of movements) {
    const from = currentPosition(db, m.level_gd_id, m.from_position)
    if (from == null) { decide.run('rejected', account.id, m.id); continue }
    try {
      tx(db, () => {
        const res = moveLevel(db, from, m.to_position, account.id)
        decide.run('approved', account.id, m.id)
        if (res.moved) moved++
      })
    } catch (e) {
      console.warn(`[submit-all] couldn't apply movement ${m.id}:`, (e as Error).message)
    }
  }

  if (placed || moved) afterListChange(db)
  return { ok: true, placed, moved }
})

function currentPosition(db: ReturnType<typeof getDb>, gdId: number | null, recorded: number): number | null {
  if (gdId) {
    const rows = db.prepare(`SELECT position FROM levels WHERE gd_id = ?`).all(gdId) as { position: number }[]
    if (rows.length === 1) return rows[0]!.position
  }
  const at = db.prepare(`SELECT position FROM levels WHERE position = ?`).get(recorded) as { position: number } | undefined
  return at?.position ?? null
}

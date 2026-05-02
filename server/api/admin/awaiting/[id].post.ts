import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { recomputePoints } from '~/server/utils/points'

/**
 * Move an awaiting-placement level onto the main list at `placement`, or
 * remove it from awaiting entirely. Awaiting levels never go to the void list:
 * they already have a difficulty opinion (that's why they got out of pending).
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const body = await readBody<{ action: 'place' | 'remove'; placement?: number; reason?: string }>(event)
  if (body.action !== 'place' && body.action !== 'remove') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  const db = getDb()
  const sub = db.prepare(`SELECT * FROM awaiting_levels WHERE id = ?`).get(id) as any
  if (!sub) throw createError({ statusCode: 404, statusMessage: 'Awaiting level not found.' })
  // Resolve the original submitter via the linked pending row (we copied
  // pending_id when sending the level here in the first place).
  const submitterId: number | null = sub.pending_id
    ? (db.prepare(`SELECT submitted_by FROM pending_levels WHERE id = ?`).get(sub.pending_id) as { submitted_by: number | null } | undefined)?.submitted_by ?? null
    : null

  if (body.action === 'remove') {
    db.prepare(`DELETE FROM awaiting_levels WHERE id = ?`).run(id)
    if (submitterId) {
      sendInboxMessage(db, submitterId, {
        kind: 'awaiting_removed',
        subject: `"${sub.name}" was removed from the awaiting placement list`,
        body: reason || null,
        related_kind: 'awaiting_level',
        related_id: sub.id,
        sent_by: account.id,
      })
    }
    return { ok: true }
  }

  const placement = Number(body.placement)
  if (!Number.isInteger(placement) || placement <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A valid placement (1-based position) is required.' })
  }

  db.exec('BEGIN')
  try {
    const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
    const insertPos = Math.min(placement, maxPos + 1)
    db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ?`).run(insertPos)
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
    db.prepare(
      `INSERT INTO levels
        (position, name, gd_id, gddl_tier, difficulty, main_skillset, verify_date,
         verification, verification_url, year_verified, category, source_tab,
         creator, permanent, enjoyment, pov_placement, placement_source, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', 'ALL Submission', NULL, 1, ?, ?, ?, ?)`,
    ).run(
      insertPos,
      sub.name,
      sub.gd_id,
      sub.gddl_tier,
      sub.difficulty,
      sub.main_skillset,
      sub.verify_date,
      sub.verification,
      sub.verification_url,
      sub.verify_date && /^\d{4}/.test(sub.verify_date) ? Number(sub.verify_date.slice(0, 4)) : null,
      sub.enjoyment,
      sub.pov_placement,
      sub.placement_source ?? 'All Levels List',
      submitterId,
    )
    db.prepare(`DELETE FROM awaiting_levels WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  recomputePoints(db)

  return { ok: true, placement }
})

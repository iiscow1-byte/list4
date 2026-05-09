import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { recomputePoints } from '~/server/utils/points'
import { recordPlacement } from '~/server/utils/changes'

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
  const body = await readBody<{
    action: 'place' | 'remove' | 'return' | 'save_placement' | 'update_video' | 'save_flags' | 'save_metadata'
    placement?: number
    reason?: string
    gddl_tier?: string
    difficulty?: string
    same_as_above?: boolean
    duplicate_of_id?: number | null
    is_alternate?: boolean
    alternate_of_id?: number | null
    tentative_placement?: boolean
    verification_url?: string | null
    fields?: Record<string, unknown>
  }>(event)
  const VALID_ACTIONS = new Set(['place', 'remove', 'return', 'save_placement', 'update_video', 'save_flags', 'save_metadata'])
  if (!VALID_ACTIONS.has(body.action)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  const db = getDb()
  const sub = db.prepare(`SELECT * FROM awaiting_levels WHERE id = ?`).get(id) as any
  if (!sub) throw createError({ statusCode: 404, statusMessage: 'Awaiting level not found.' })

  if (body.action === 'save_metadata') {
    // Whitelisted fields admins can edit on an awaiting row. `placement_suggestion`
    // is intentionally excluded — it has its own save_placement action.
    const ALLOWED = new Set([
      'name', 'gd_id', 'verifier', 'verify_date', 'gddl_tier', 'difficulty',
      'enjoyment', 'main_skillset', 'tags', 'notes',
      'verification', 'verification_url', 'placement_source',
    ])
    const fields = body.fields ?? {}
    const cols: string[] = []
    const params: any[] = []
    for (const [k, v] of Object.entries(fields)) {
      if (!ALLOWED.has(k)) continue
      cols.push(`${k} = ?`)
      params.push(v === '' || v === undefined ? null : v)
    }
    if (cols.length === 0) return { ok: true, updated: 0 }
    params.push(id)
    const res = db.prepare(`UPDATE awaiting_levels SET ${cols.join(', ')} WHERE id = ?`).run(...params)
    return { ok: true, updated: res.changes }
  }
  // Resolve the original submitter via the linked pending row (we copied
  // pending_id when sending the level here in the first place).
  const submitterId: number | null = sub.pending_id
    ? (db.prepare(`SELECT submitted_by FROM pending_levels WHERE id = ?`).get(sub.pending_id) as { submitted_by: number | null } | undefined)?.submitted_by ?? null
    : null

  if (body.action === 'save_placement') {
    const n = (typeof body.placement === 'number' && Number.isInteger(body.placement) && body.placement > 0) ? body.placement : null
    db.prepare(`UPDATE awaiting_levels SET placement_suggestion = ? WHERE id = ?`).run(n, id)
    return { ok: true }
  }

  if (body.action === 'save_flags') {
    db.prepare(
      `UPDATE awaiting_levels SET same_as_above=?, duplicate_of_id=?, is_alternate=?, alternate_of_id=?, tentative_placement=? WHERE id=?`,
    ).run(
      body.same_as_above ? 1 : 0,
      body.duplicate_of_id ?? null,
      body.is_alternate ? 1 : 0,
      body.alternate_of_id ?? null,
      body.tentative_placement ? 1 : 0,
      id,
    )
    return { ok: true }
  }

  if (body.action === 'update_video') {
    const url = typeof body.verification_url === 'string' ? body.verification_url.trim() || null : null
    db.prepare(`UPDATE awaiting_levels SET verification_url = ? WHERE id = ?`).run(url, id)
    return { ok: true }
  }

  if (body.action === 'return') {
    if (!sub.pending_id) throw createError({ statusCode: 400, statusMessage: 'No linked pending submission to return to.' })
    db.exec('BEGIN')
    try {
      db.prepare(`UPDATE pending_levels SET status='pending', decided_by=NULL, decided_at=NULL WHERE id = ?`).run(sub.pending_id)
      db.prepare(`DELETE FROM awaiting_levels WHERE id = ?`).run(id)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, returned: true }
  }

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

  // Admin can override the submitter's flags when placing.
  const sameAsAbove = typeof body.same_as_above === 'boolean'
    ? (body.same_as_above ? 1 : 0)
    : (sub.same_as_above ? 1 : 0)
  const duplicateOfId = body.duplicate_of_id !== undefined ? (body.duplicate_of_id ?? null) : (sub.duplicate_of_id ?? null)
  const isAlternate = typeof body.is_alternate === 'boolean'
    ? (body.is_alternate ? 1 : 0)
    : (sub.is_alternate ? 1 : 0)
  const alternateOfId = body.alternate_of_id !== undefined ? (body.alternate_of_id ?? null) : (sub.alternate_of_id ?? null)
  const tentativePlacement = typeof body.tentative_placement === 'boolean'
    ? (body.tentative_placement ? 1 : 0)
    : (sub.tentative_placement ? 1 : 0)

  db.exec('BEGIN')
  try {
    const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
    const insertPos = Math.min(placement, maxPos + 1)
    db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ?`).run(insertPos)
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
    // pov_placement records the position assigned at acceptance time — it
    // doesn't follow later admin moves.
    const result = db.prepare(
      `INSERT INTO levels
        (position, name, gd_id, gddl_tier, difficulty, main_skillset, verify_date,
         verification, verification_url, year_verified, category, source_tab,
         creator, permanent, enjoyment, pov_placement, placement_source, submitted_by,
         same_as_above, duplicate_of_id, is_alternate, alternate_of_id, rated, tentative_placement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', 'ALL Submission', NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      insertPos,
      sub.name,
      sub.gd_id,
      (typeof body.gddl_tier === 'string' && body.gddl_tier.trim()) ? body.gddl_tier.trim() : sub.gddl_tier,
      (typeof body.difficulty === 'string' && body.difficulty.trim()) ? body.difficulty.trim() : sub.difficulty,
      sub.main_skillset,
      sub.verify_date,
      sub.verification,
      sub.verification_url,
      sub.verify_date && /^\d{4}/.test(sub.verify_date) ? Number(sub.verify_date.slice(0, 4)) : null,
      sub.enjoyment,
      insertPos,
      sub.placement_source ?? 'All Levels List',
      submitterId,
      sameAsAbove,
      duplicateOfId,
      isAlternate,
      alternateOfId,
      sub.rated ?? null,
      tentativePlacement,
    )
    recordPlacement(db, Number(result.lastInsertRowid), insertPos, account.id)
    db.prepare(`DELETE FROM awaiting_levels WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  recomputePoints(db)

  return { ok: true, placement }
})

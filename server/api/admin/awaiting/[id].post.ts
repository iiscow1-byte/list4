import { getDb } from '~/server/db'
import { requireListStaff } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { afterListChange, tx } from '~/server/utils/list-ops'
import { placeSubmission } from '~/server/utils/place-submission'

/**
 * Move an awaiting-placement level onto the main list at `placement`, or
 * remove it from awaiting entirely. Awaiting levels never go to the void list:
 * they already have a difficulty opinion (that's why they got out of pending).
 */
export default defineEventHandler(async (event) => {
  const account = requireListStaff(event)
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
      'enjoyment', 'main_skillset', 'tags', 'notes', 'admin_notes',
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

  const placed = tx(db, () => {
    const res = placeSubmission(db, sub, placement, { actorId: account.id, submittedBy: submitterId, flags: body })
    db.prepare(`DELETE FROM awaiting_levels WHERE id = ?`).run(id)
    return res
  })
  afterListChange(db)

  return { ok: true, placement: placed.position }
})

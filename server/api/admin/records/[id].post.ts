import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'

export default defineEventHandler(async (event) => {
  const me = requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const body = await readBody(event)
  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'action must be "approve" or "reject"' })
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  const db = getDb()
  const rec = db.prepare(
    `SELECT r.id, r.permanent, r.level_id, r.player_name, r.is_verification_claim,
            r.submitted_by, l.name AS level_name
       FROM records r
       JOIN levels l ON l.id = r.level_id
       WHERE r.id = ?`,
  ).get(id) as { id: number; permanent: number; level_id: number; player_name: string; is_verification_claim: number; submitted_by: number | null; level_name: string } | undefined
  if (!rec || rec.permanent) {
    throw createError({ statusCode: 404, statusMessage: 'No pending record with that id.' })
  }

  if (action === 'approve') {
    db.prepare(
      `UPDATE records SET permanent = 1, decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
    ).run(me.id, id)
    // Honor the verifier claim only if the level still has no verifier.
    if (rec.is_verification_claim) {
      db.prepare(
        `UPDATE levels SET verifier = ? WHERE id = ? AND (verifier IS NULL OR verifier = '')`,
      ).run(rec.player_name, rec.level_id)
    }
    // Approve any linked rating attached at submit time.
    db.prepare(
      `UPDATE opinions SET status = 'approved', decided_at = datetime('now'), decided_by = ?
        WHERE source_record_id = ? AND status = 'pending'`,
    ).run(me.id, id)
  } else {
    // Reject the linked opinion alongside the record so it doesn't outlive the
    // proof video. ON DELETE SET NULL would leave it dangling without proof.
    db.prepare(
      `UPDATE opinions SET status = 'rejected', decided_at = datetime('now'), decided_by = ?
        WHERE source_record_id = ? AND status = 'pending'`,
    ).run(me.id, id)
    db.prepare(`DELETE FROM records WHERE id = ?`).run(id)
    if (rec.submitted_by) {
      sendInboxMessage(db, rec.submitted_by, {
        kind: 'record_rejected',
        subject: `Your record submission for "${rec.level_name}" was rejected`,
        body: reason || null,
        related_kind: 'record',
        related_id: rec.id,
        sent_by: me.id,
      })
    }
  }
  return { ok: true }
})

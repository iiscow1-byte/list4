import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'

/**
 * Approve or reject a pending open-verification submission.
 * - approve: marks status='approved' so it appears on the public open-verifications list
 * - reject:  marks status='rejected' (kept for audit; reason sent to submitter)
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const body = await readBody<{ action: 'approve' | 'reject'; reason?: string }>(event)
  if (body.action !== 'approve' && body.action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  const db = getDb()
  const sub = db.prepare(
    `SELECT id, name, status, submitted_by FROM open_verifications WHERE id = ?`,
  ).get(id) as { id: number; name: string; status: string; submitted_by: number | null } | undefined
  if (!sub) throw createError({ statusCode: 404, statusMessage: 'Open verification not found.' })
  if (sub.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Already decided.' })
  }

  const newStatus = body.action === 'approve' ? 'approved' : 'rejected'
  db.prepare(
    `UPDATE open_verifications
        SET status = ?, decided_by = ?, decided_at = datetime('now')
      WHERE id = ?`,
  ).run(newStatus, account.id, id)

  if (sub.submitted_by) {
    if (body.action === 'approve') {
      sendInboxMessage(db, sub.submitted_by, {
        kind: 'open_verification_approved',
        subject: `"${sub.name}" was added to the open-verifications list`,
        body: null,
        related_kind: 'open_verification',
        related_id: sub.id,
        sent_by: account.id,
      })
    } else {
      sendInboxMessage(db, sub.submitted_by, {
        kind: 'open_verification_rejected',
        subject: `Your open-verification submission for "${sub.name}" was rejected`,
        body: reason || null,
        related_kind: 'open_verification',
        related_id: sub.id,
        sent_by: account.id,
      })
    }
  }

  return { ok: true }
})

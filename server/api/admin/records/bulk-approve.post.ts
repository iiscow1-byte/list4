import { getDb } from '~/server/db'
import { requireListStaff } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const me = requireListStaff(event)
  const body = await readBody(event)
  const submitter = typeof body?.submitter === 'string' ? body.submitter.trim() : ''
  if (!submitter) throw createError({ statusCode: 400, statusMessage: 'submitter is required' })

  const db = getDb()
  const account = db.prepare(
    `SELECT id FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(submitter) as { id: number } | undefined
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Submitter not found.' })

  const pending = db.prepare(
    `SELECT r.id, r.level_id, r.player_name, r.is_verification_claim
       FROM records r
      WHERE r.permanent = 0 AND r.submitted_by = ?`,
  ).all(account.id) as { id: number; level_id: number; player_name: string; is_verification_claim: number }[]

  for (const rec of pending) {
    db.prepare(
      `UPDATE records SET permanent = 1, decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
    ).run(me.id, rec.id)
    if (rec.is_verification_claim) {
      db.prepare(
        `UPDATE levels SET verifier = ? WHERE id = ? AND (verifier IS NULL OR verifier = '')`,
      ).run(rec.player_name, rec.level_id)
    }
    db.prepare(
      `UPDATE opinions SET status = 'approved', decided_at = datetime('now'), decided_by = ?
        WHERE source_record_id = ? AND status = 'pending'`,
    ).run(me.id, rec.id)
  }

  return { ok: true, approved: pending.length }
})

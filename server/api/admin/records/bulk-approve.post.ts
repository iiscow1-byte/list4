import { getDb } from '~/server/db'
import { requireListStaff } from '~/server/utils/auth'
import { announceInOrder, approvePendingRecord } from '~/server/utils/record-decisions'

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

  const announcements = pending.map((rec) => approvePendingRecord(db, rec, me, { announce: false, bulk: true }))
  announceInOrder(db, announcements)

  return { ok: true, approved: pending.length }
})

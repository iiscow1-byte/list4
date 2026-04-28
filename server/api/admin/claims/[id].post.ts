import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody(event)
  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'action must be "approve" or "reject"' })
  }

  const db = getDb()
  const claim = db.prepare(`SELECT * FROM claim_requests WHERE id = ?`).get(id) as any
  if (!claim || claim.status !== 'pending') {
    throw createError({ statusCode: 404, statusMessage: 'No pending claim with that id.' })
  }

  if (action === 'approve') {
    const taken = db.prepare(
      `SELECT 1 FROM accounts WHERE claimed_player = ? COLLATE NOCASE AND id != ?`,
    ).get(claim.player_name, claim.account_id)
    if (taken) {
      throw createError({ statusCode: 409, statusMessage: 'That player has already been claimed by someone else.' })
    }
    db.prepare(`UPDATE accounts SET claimed_player = ? WHERE id = ?`).run(claim.player_name, claim.account_id)
  }

  db.prepare(
    `UPDATE claim_requests SET status = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
  ).run(action === 'approve' ? 'approved' : 'rejected', me.id, id)

  return { ok: true }
})

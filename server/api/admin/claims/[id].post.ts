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
    if (claim.source === 'aredl') {
      if (!claim.aredl_player_uuid) {
        throw createError({ statusCode: 400, statusMessage: 'AREDL claim is missing player UUID.' })
      }
      const taken = db.prepare(
        `SELECT 1 FROM accounts WHERE claimed_aredl_uuid = ? AND id != ?`,
      ).get(claim.aredl_player_uuid, claim.account_id)
      if (taken) {
        throw createError({ statusCode: 409, statusMessage: 'That AREDL player has already been claimed by someone else.' })
      }
      db.prepare(`UPDATE accounts SET claimed_aredl_uuid = ? WHERE id = ?`).run(claim.aredl_player_uuid, claim.account_id)
      db.prepare(`UPDATE aredl_players SET claimed_account_id = ? WHERE uuid = ?`)
        .run(claim.account_id, claim.aredl_player_uuid)
    } else if (claim.source === 'gdl') {
      if (!claim.gdl_player_id) {
        throw createError({ statusCode: 400, statusMessage: 'GDL claim is missing player id.' })
      }
      const taken = db.prepare(
        `SELECT 1 FROM accounts WHERE claimed_gdl_id = ? AND id != ?`,
      ).get(claim.gdl_player_id, claim.account_id)
      if (taken) {
        throw createError({ statusCode: 409, statusMessage: 'That GDL player has already been claimed by someone else.' })
      }
      db.prepare(`UPDATE accounts SET claimed_gdl_id = ? WHERE id = ?`)
        .run(claim.gdl_player_id, claim.account_id)
      db.prepare(`UPDATE gdl_players SET claimed_account_id = ? WHERE gdl_id = ?`)
        .run(claim.account_id, claim.gdl_player_id)
    } else if (claim.source === 'pointercrate') {
      if (!claim.pointercrate_player_id) {
        throw createError({ statusCode: 400, statusMessage: 'Pointercrate claim is missing player id.' })
      }
      const taken = db.prepare(
        `SELECT 1 FROM accounts WHERE claimed_pointercrate_id = ? AND id != ?`,
      ).get(claim.pointercrate_player_id, claim.account_id)
      if (taken) {
        throw createError({ statusCode: 409, statusMessage: 'That Pointercrate player has already been claimed by someone else.' })
      }
      db.prepare(`UPDATE accounts SET claimed_pointercrate_id = ? WHERE id = ?`)
        .run(claim.pointercrate_player_id, claim.account_id)
      db.prepare(`UPDATE pointercrate_players SET claimed_account_id = ? WHERE pc_id = ?`)
        .run(claim.account_id, claim.pointercrate_player_id)
    } else {
      const taken = db.prepare(
        `SELECT 1 FROM accounts WHERE claimed_player = ? COLLATE NOCASE AND id != ?`,
      ).get(claim.player_name, claim.account_id)
      if (taken) {
        throw createError({ statusCode: 409, statusMessage: 'That player has already been claimed by someone else.' })
      }
      db.prepare(`UPDATE accounts SET claimed_player = ? WHERE id = ?`).run(claim.player_name, claim.account_id)
    }
  }

  db.prepare(
    `UPDATE claim_requests SET status = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
  ).run(action === 'approve' ? 'approved' : 'rejected', me.id, id)

  return { ok: true }
})

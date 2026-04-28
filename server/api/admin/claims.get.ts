import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const items = getDb().prepare(
    `SELECT cr.id, cr.player_name, cr.created_at, a.username, a.id AS account_id
       FROM claim_requests cr
       JOIN accounts a ON a.id = cr.account_id
      WHERE cr.status = 'pending'
      ORDER BY cr.created_at ASC`,
  ).all()
  return { items }
})

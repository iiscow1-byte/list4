import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const pending = getDb().prepare(
    `SELECT id, player_name, source, aredl_player_uuid, pointercrate_player_id, gdl_player_id, created_at
       FROM claim_requests
      WHERE account_id = ? AND status = 'pending'
   ORDER BY created_at DESC LIMIT 1`,
  ).get(me.id) ?? null
  return { pending }
})

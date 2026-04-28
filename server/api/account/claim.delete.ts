import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const result = getDb().prepare(
    `DELETE FROM claim_requests WHERE account_id = ? AND status = 'pending'`,
  ).run(me.id)
  return { ok: true, cancelled: result.changes }
})

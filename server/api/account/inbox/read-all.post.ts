import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  getDb().prepare(
    `UPDATE inbox_messages SET read_at = datetime('now') WHERE account_id = ? AND read_at IS NULL`,
  ).run(me.id)
  return { ok: true }
})

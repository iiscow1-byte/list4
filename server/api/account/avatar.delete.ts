import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  getDb().prepare(`UPDATE accounts SET avatar_blob = NULL, avatar_type = NULL WHERE id = ?`).run(me.id)
  return { ok: true }
})

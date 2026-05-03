import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const items = getDb().prepare(
    `SELECT target_name AS name, created_at FROM follows
      WHERE follower_account_id = ?
      ORDER BY created_at DESC`,
  ).all(me.id)
  return { items }
})

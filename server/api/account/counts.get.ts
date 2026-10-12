import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/** Unread inbox messages and open friend requests, for the header badges. */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const db = getDb()
  const inbox = (db.prepare(
    `SELECT COUNT(*) AS n FROM inbox_messages WHERE account_id = ? AND read_at IS NULL`,
  ).get(me.id) as { n: number }).n
  const friends = (db.prepare(
    `SELECT COUNT(*) AS n FROM friend_requests r JOIN accounts a ON a.id = r.from_account_id
      WHERE r.to_account_id = ? AND a.banned_at IS NULL`,
  ).get(me.id) as { n: number }).n
  setHeader(event, 'cache-control', 'no-store')
  return { inbox, friends }
})

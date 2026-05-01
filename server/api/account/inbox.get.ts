import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const db = getDb()
  const items = db.prepare(
    `SELECT m.id, m.kind, m.subject, m.body, m.related_kind, m.related_id,
            m.read_at, m.created_at,
            a.username AS sent_by_username
       FROM inbox_messages m
       LEFT JOIN accounts a ON a.id = m.sent_by
      WHERE m.account_id = ?
      ORDER BY m.created_at DESC
      LIMIT 200`,
  ).all(me.id)
  const unread = (db.prepare(
    `SELECT COUNT(*) AS n FROM inbox_messages WHERE account_id = ? AND read_at IS NULL`,
  ).get(me.id) as { n: number }).n
  return { items, unread }
})

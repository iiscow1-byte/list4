import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const target = String(getQuery(event).target ?? '').trim()
  if (!target) throw createError({ statusCode: 400, statusMessage: 'target required.' })

  const db = getDb()
  const items = db.prepare(
    `SELECT a.username, a.role, (a.avatar_blob IS NOT NULL) AS has_avatar
       FROM follows f
       JOIN accounts a ON a.id = f.follower_account_id
      WHERE f.target_name = ? COLLATE NOCASE
        AND a.banned_at IS NULL
      ORDER BY f.created_at DESC
      LIMIT 200`,
  ).all(target) as { username: string; role: string; has_avatar: number }[]

  return { items: items.map((r) => ({ ...r, has_avatar: !!r.has_avatar })) }
})

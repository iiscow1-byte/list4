import { getDb } from '~/server/db'

/**
 * Who follows a profile. `name` mirrors `following.get.ts` so one component can
 * render either list — a follower is always an account, so it equals `username`.
 */
const MAX = 500

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
      LIMIT ${MAX}`,
  ).all(target) as { username: string; role: string; has_avatar: number }[]

  return { items: items.map((r) => ({ ...r, name: r.username, has_avatar: !!r.has_avatar })) }
})

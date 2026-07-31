import { getDb } from '~/server/db'

const VALID_KINDS = new Set(['profile', 'progress', 'open_verification', 'level'])

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const kind = String(q.kind ?? '')
  const targetId = Number(q.target_id)
  if (!VALID_KINDS.has(kind) || !Number.isInteger(targetId) || targetId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'kind and target_id required.' })
  }

  const db = getDb()
  const items = db.prepare(
    `SELECT c.id, c.account_id, c.body, c.created_at,
            a.username, a.role,
            (a.avatar_blob IS NOT NULL) AS has_avatar
       FROM comments c
       JOIN accounts a ON a.id = c.account_id
      WHERE a.banned_at IS NULL
        AND c.target_kind = ?
        AND c.target_id   = ?
      ORDER BY c.created_at ASC
      LIMIT 200`,
  ).all(kind, targetId) as {
    id: number
    account_id: number
    body: string
    created_at: string
    username: string
    role: string
    has_avatar: number
  }[]

  return { items: items.map((r) => ({ ...r, has_avatar: !!r.has_avatar })) }
})

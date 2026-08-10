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
  // The name decorations come along because a comment prints the same name the
  // rest of the site does — through `UserName` — and a component that renders
  // them everywhere except here would be the thing that looks broken.
  const items = db.prepare(
    `SELECT c.id, c.account_id, c.body, c.created_at,
            a.username, a.role,
            a.name_emoji, a.name_badge, a.name_badge_color,
            cl.tag AS clan_tag, cl.name AS clan_name, cl.color AS clan_color,
            (a.avatar_blob IS NOT NULL) AS has_avatar
       FROM comments c
       JOIN accounts a ON a.id = c.account_id
       LEFT JOIN clan_members cm ON cm.account_id = a.id
       LEFT JOIN clans        cl ON cl.id = cm.clan_id
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
    name_emoji: string | null
    name_badge: string | null
    name_badge_color: string | null
    clan_tag: string | null
    clan_name: string | null
    clan_color: string | null
    has_avatar: number
  }[]

  // The clan arrives as three flat columns because it is one LEFT JOIN on a
  // table with one row per account; it leaves as the object `UserName` takes.
  return {
    items: items.map(({ clan_tag, clan_name, clan_color, ...r }) => ({
      ...r,
      has_avatar: !!r.has_avatar,
      clan: clan_tag ? { tag: clan_tag, name: clan_name, color: clan_color } : null,
    })),
  }
})

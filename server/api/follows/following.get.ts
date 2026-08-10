import { getDb } from '~/server/db'
import { attachClans } from '~/server/utils/clans'

/**
 * Who a profile follows.
 *
 * The mirror of `followers.get.ts`, and public for the same reason: both sides
 * of a follow are already visible on the profile page, capped at 24 with no way
 * to see the rest. This is that list in full.
 *
 * `target` is the profile's canonical name — the same key follows are stored
 * under — so it accepts either a username or a claimed leaderboard name, which
 * is what the two links to it have in hand.
 *
 * Follows point at *names*, not accounts, because you can follow a leaderboard
 * player who has never signed up. Each row therefore carries the account behind
 * the name when there is one, and nothing but the name when there isn't.
 */
const MAX = 500

export default defineEventHandler((event) => {
  const target = String(getQuery(event).target ?? '').trim()
  if (!target) throw createError({ statusCode: 400, statusMessage: 'target required.' })

  const db = getDb()
  const account = db.prepare(
    `SELECT id FROM accounts
      WHERE (username = ? COLLATE NOCASE OR claimed_player = ? COLLATE NOCASE)
        AND banned_at IS NULL
      LIMIT 1`,
  ).get(target, target) as { id: number } | undefined
  // A leaderboard player with no account can be followed but can't follow.
  if (!account) return { items: [] }

  const items = db.prepare(
    `SELECT f.target_name AS name,
            a.username, a.role, (a.avatar_blob IS NOT NULL) AS has_avatar
       FROM follows f
       LEFT JOIN accounts a
         ON (a.claimed_player = f.target_name COLLATE NOCASE
             OR a.username = f.target_name COLLATE NOCASE)
        AND a.banned_at IS NULL
      WHERE f.follower_account_id = ?
      ORDER BY f.created_at DESC
      LIMIT ${MAX}`,
  ).all(account.id) as
    { name: string; username: string | null; role: string | null; has_avatar: number | null }[]

  return {
    items: attachClans(
      db,
      items.map((r) => ({
        name: r.name,
        username: r.username,
        role: r.role,
        has_avatar: !!r.has_avatar,
      })),
      'name',
    ),
  }
})

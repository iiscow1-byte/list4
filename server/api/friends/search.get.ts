import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { friendState } from '~/server/utils/friends'

/**
 * Accounts to send a friend request to.
 *
 * Every hit carries how you already stand with that person, because a search
 * result that offers "Add friend" next to somebody who asked *you* yesterday is
 * worse than no button at all. People already in some state with you are shown
 * rather than filtered out — "you already sent them one" is the answer to "why
 * can't I find them".
 */
const LIMIT = 20

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const q = String(getQuery(event).q ?? '').trim()
  if (q.length < 2) return { items: [] }

  const db = getDb()
  const rows = db.prepare(`
    SELECT a.id, a.username, a.claimed_player, a.country,
           (a.avatar_blob IS NOT NULL) AS has_avatar,
           c.tag AS clan_tag, c.name AS clan_name, c.color AS clan_color
      FROM accounts a
      LEFT JOIN clan_members cm ON cm.account_id = a.id
      LEFT JOIN clans        c  ON c.id = cm.clan_id
     WHERE a.banned_at IS NULL
       AND a.id <> ?
       AND (a.username LIKE ? COLLATE NOCASE OR a.claimed_player LIKE ? COLLATE NOCASE)
     ORDER BY
       -- An exact match is what somebody typing a full name wants first.
       (a.username = ? COLLATE NOCASE) DESC,
       LENGTH(a.username) ASC,
       a.username COLLATE NOCASE ASC
     LIMIT ${LIMIT}
  `).all(me.id, `%${q}%`, `%${q}%`, q) as any[]

  return {
    items: rows.map((r) => ({
      id: r.id,
      username: r.username,
      claimed_player: r.claimed_player,
      country: r.country,
      has_avatar: !!r.has_avatar,
      clan: r.clan_tag ? { tag: r.clan_tag, name: r.clan_name, color: r.clan_color } : null,
      state: friendState(db, me.id, r.id),
    })),
  }
})

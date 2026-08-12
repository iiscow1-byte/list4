import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * Accounts the owner could invite, by name.
 *
 * Its own endpoint rather than `/api/users/search` because that one answers in
 * *player names* — the names records are filed under, which is what a record
 * form wants — and an invite needs an account id. Handing the clan page a list
 * of names it then has to resolve back to accounts is how you end up inviting
 * the wrong person with a shared name.
 *
 * Owner-only, and it says who is already spoken for rather than hiding them:
 * "already in a clan" is the answer to "why can't I invite them", and a search
 * that silently omits somebody looks broken.
 */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const tag = String(getRouterParam(event, 'tag') ?? '').trim()
  const q = String(getQuery(event).q ?? '').trim()

  const db = getDb()
  const clan = db.prepare(`SELECT id, owner_account_id FROM clans WHERE tag = ?`)
    .get(tag) as { id: number; owner_account_id: number } | undefined
  if (!clan) throw createError({ statusCode: 404, statusMessage: 'No such clan.' })
  if (me.id !== clan.owner_account_id) {
    throw createError({ statusCode: 403, statusMessage: 'Only the clan owner can invite people.' })
  }
  if (q.length < 2) return { items: [] }

  const items = db.prepare(
    `SELECT a.id, a.username, a.claimed_player,
            (a.avatar_blob IS NOT NULL) AS has_avatar,
            (SELECT c.tag FROM clan_members m JOIN clans c ON c.id = m.clan_id
              WHERE m.account_id = a.id) AS clan_tag,
            (SELECT 1 FROM clan_invites i
              WHERE i.clan_id = ? AND i.account_id = a.id) AS invited
       FROM accounts a
      WHERE a.banned_at IS NULL
        AND a.id != ?
        AND (a.username LIKE ? COLLATE NOCASE OR a.claimed_player LIKE ? COLLATE NOCASE)
      ORDER BY
        -- An exact match is what somebody typing a full name meant.
        (a.username = ? COLLATE NOCASE) DESC,
        a.username COLLATE NOCASE ASC
      LIMIT 12`,
  ).all(clan.id, me.id, `%${q}%`, `%${q}%`, q).map((r: any) => ({
    id: r.id,
    username: r.username,
    claimed_player: r.claimed_player,
    has_avatar: !!r.has_avatar,
    clan_tag: r.clan_tag ?? null,
    invited: !!r.invited,
  }))

  return { items }
})

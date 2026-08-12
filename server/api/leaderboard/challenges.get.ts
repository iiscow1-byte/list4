import { getDb } from '~/server/db'
import { isChallengeSql } from '~/server/utils/challenge-expr'
import { clanTagsForPlayers, type ClanBadge } from '~/server/utils/clans'
import { aredlAvatarsForPlayers } from '~/server/utils/aredl-avatars'
import { getCurrentAccount } from '~/server/utils/auth'

/**
 * The challenge leaderboard: players ranked by the challenges they have beaten.
 *
 * A separate ranking rather than a filter on the main one, because it is a
 * separate skill. Challenges are short, unrated and tiered on their own scale,
 * and the points a level is worth on the main list reflect where it sits among
 * fifty thousand levels — so a player with three hundred challenges and a
 * player with three extreme demons are not comparable on one number, and the
 * main leaderboard has always answered the second question only.
 *
 * What counts as a challenge is the site's one definition, shared with
 * `/api/levels` and the challenge list view — see `server/utils/challenge-expr.ts`.
 *
 * ## Ranking
 *
 * By points first, then by count. Points are the sum of the challenges beaten,
 * so somebody who has done the hardest few outranks somebody who has done many
 * easy ones — the same principle the main list uses. `hardest` is the
 * best-placed challenge, by challenge rank rather than list position, since
 * that is the number the challenge list prints.
 */
const IS_CHALLENGE = isChallengeSql('l', 'c')

/**
 * Built in full and cached briefly, the same way the main leaderboard is: it
 * scans every accepted record against every level and depends on nothing about
 * the caller, so paging through it should not rebuild it per page.
 */
const TTL_MS = 30_000
type Row = {
  player: string
  points: number
  challenges: number
  hardest: string | null
  hardest_rank: number | null
  hardest_position: number | null
}
let cache: { at: number; rows: Row[] } | null = null

export function invalidateChallengeLeaderboard(): void {
  cache = null
}

function build(db: ReturnType<typeof getDb>): Row[] {
  /**
   * One pass over every accepted record on a challenge.
   *
   * `challenge_rank` is computed in a CTE over the challenges alone so it is a
   * position among challenges (1, 2, 3…) rather than a list placement in the
   * tens of thousands — which is what makes "hardest challenge: #4" readable.
   */
  const rows = db.prepare(`
    WITH challenges AS (
      SELECT l.id, l.position, l.name, l.points,
             ROW_NUMBER() OVER (ORDER BY l.position ASC) AS challenge_rank
        FROM levels l
        LEFT JOIN gd_info_cache c ON c.gd_id = l.gd_id
       WHERE ${IS_CHALLENGE}
    )
    SELECT r.player_name AS player,
           COUNT(*)                       AS challenges,
           COALESCE(SUM(ch.points), 0)    AS points,
           MIN(ch.challenge_rank)         AS hardest_rank
      FROM records r
      JOIN challenges ch ON ch.id = r.level_id
     WHERE r.permanent = 1
     GROUP BY LOWER(r.player_name)
     ORDER BY points DESC, challenges DESC
  `).all() as (Omit<Row, 'hardest' | 'hardest_position'> & { hardest_rank: number | null })[]

  // The name of each player's best challenge, in one query rather than one per
  // player — a leaderboard of a few thousand would otherwise be a few thousand
  // round trips to print a column.
  const ranks = [...new Set(rows.map((r) => r.hardest_rank).filter((n): n is number => n != null))]
  const byRank = new Map<number, { name: string; position: number }>()
  for (let i = 0; i < ranks.length; i += 400) {
    const chunk = ranks.slice(i, i + 400)
    const ph = chunk.map(() => '?').join(',')
    const found = db.prepare(`
      WITH challenges AS (
        SELECT l.position, l.name,
               ROW_NUMBER() OVER (ORDER BY l.position ASC) AS challenge_rank
          FROM levels l
          LEFT JOIN gd_info_cache c ON c.gd_id = l.gd_id
         WHERE ${IS_CHALLENGE}
      )
      SELECT challenge_rank, name, position FROM challenges WHERE challenge_rank IN (${ph})
    `).all(...chunk) as { challenge_rank: number; name: string; position: number }[]
    for (const f of found) byRank.set(f.challenge_rank, { name: f.name, position: f.position })
  }

  return rows.map((r) => ({
    ...r,
    hardest: r.hardest_rank != null ? byRank.get(r.hardest_rank)?.name ?? null : null,
    hardest_position: r.hardest_rank != null ? byRank.get(r.hardest_rank)?.position ?? null : null,
  }))
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.min(2000, Math.max(1, Number(q.limit) || 200))
  const offset = Math.max(0, Number(q.offset) || 0)
  const search = String(q.q ?? '').trim().toLowerCase()
  const followedOnly = String(q.followed ?? '') === '1'

  const db = getDb()
  if (!cache || Date.now() - cache.at >= TTL_MS) {
    cache = { at: Date.now(), rows: build(db) }
  }

  let filtered = cache.rows
  if (followedOnly) {
    const me = getCurrentAccount(event)
    if (!me) return { total: 0, items: [] }
    const follows = new Set((db.prepare(
      `SELECT target_name FROM follows WHERE follower_account_id = ?`,
    ).all(me.id) as { target_name: string }[]).map((f) => f.target_name.toLowerCase()))
    filtered = filtered.filter((r) => follows.has(r.player.toLowerCase()))
  }
  if (search) filtered = filtered.filter((r) => r.player.toLowerCase().includes(search))

  const total = filtered.length
  const items = filtered.slice(offset, offset + limit).map((p, i) => ({
    rank: offset + i + 1,
    ...p,
    country: null as string | null,
    account_username: null as string | null,
    has_avatar: false,
    aredl_avatar_url: null as string | null,
    clan: null as ClanBadge | null,
  }))

  // Accounts, clans and faces for this page only — the same shape the other two
  // leaderboards return, so the page can render all three with one row template.
  const names = items.map((p) => p.player)
  if (names.length) {
    const ph = names.map(() => '?').join(',')
    const accs = db.prepare(
      `SELECT username, claimed_player, country, (avatar_blob IS NOT NULL) AS has_avatar
         FROM accounts
        WHERE banned_at IS NULL
          AND (username COLLATE NOCASE IN (${ph}) OR claimed_player COLLATE NOCASE IN (${ph}))`,
    ).all(...names, ...names) as
      { username: string; claimed_player: string | null; country: string | null; has_avatar: number }[]
    const byName = new Map<string, { username: string; has_avatar: boolean; country: string | null }>()
    for (const a of accs) {
      const entry = { username: a.username, has_avatar: !!a.has_avatar, country: a.country }
      byName.set(a.username.toLowerCase(), entry)
      if (a.claimed_player) byName.set(a.claimed_player.toLowerCase(), entry)
    }
    for (const p of items) {
      const hit = byName.get(p.player.toLowerCase())
      p.account_username = hit?.username ?? null
      p.has_avatar = hit?.has_avatar ?? false
      p.country = hit?.country ?? null
    }

    const faceless = items.filter((p) => !p.has_avatar).map((p) => p.player)
    if (faceless.length) {
      const faces = aredlAvatarsForPlayers(db, faceless)
      if (faces.size) {
        for (const p of items) {
          if (p.has_avatar) continue
          p.aredl_avatar_url = faces.get(p.player.toLowerCase()) ?? null
        }
      }
    }

    const clans = clanTagsForPlayers(db, names)
    if (clans.size) for (const p of items) p.clan = clans.get(p.player.toLowerCase()) ?? null
  }

  return { total, items }
})

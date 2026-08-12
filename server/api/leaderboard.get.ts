import { getDb } from '~/server/db'
import { listDerivedPlayers } from '~/server/utils/leaderboard'
import { getCurrentAccount } from '~/server/utils/auth'
import { clanTagsForPlayers, type ClanBadge } from '~/server/utils/clans'
import { aredlAvatarsForPlayers } from '~/server/utils/aredl-avatars'

type Row = {
  player: string
  country: string | null
  points: number
  skill_points: number
  extremes: number
  hardest: string | null
  tier: string | null
  badge: string | null
}

/**
 * The ranked player set, cached briefly.
 *
 * Building it scans `players`, every accepted record, and every account — tens
 * of thousands of rows — and the result depends on nothing about the caller.
 * Paging through the leaderboard used to redo all of that per page. The window
 * is short enough that a newly approved record shows up almost immediately.
 */
const BASE_TTL_MS = 30_000
let baseCache: { at: number; rows: Row[] } | null = null

/** Dropped when something that feeds the leaderboard changes. */
export function invalidateLeaderboardCache(): void {
  baseCache = null
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.min(2000, Math.max(1, Number(q.limit) || 100))
  const offset = Math.max(0, Number(q.offset) || 0)
  const search = String(q.q ?? '').trim()
  const followedOnly = String(q.followed ?? '') === '1'

  const db = getDb()
  const cached = baseCache && Date.now() - baseCache.at < BASE_TTL_MS ? baseCache.rows : null
  if (cached) return respond(db, event, cached, { limit, offset, search, followedOnly })

  // Build a map of player-name → role for accounts with a notable role.
  const roleRows = db.prepare(
    `SELECT COALESCE(claimed_player, username) AS player_name, role
       FROM accounts
      WHERE banned_at IS NULL
        AND role IN ('moderator', 'admin', 'owner', 'developer')`,
  ).all() as { player_name: string; role: string }[]
  const roleMap = new Map(roleRows.map((r) => [r.player_name.toLowerCase(), r.role]))

  // Count accepted records per player on Extreme Demon levels or GDDL Tier 20+.
  const extremesMap = new Map<string, number>()
  ;(db.prepare(
    `SELECT LOWER(r.player_name) AS k, COUNT(*) AS n
       FROM records r
       JOIN levels l ON l.id = r.level_id
      WHERE r.permanent = 1
        AND (l.difficulty = 'Extreme Demon'
             OR (l.gddl_tier IS NOT NULL
                 AND CAST(REPLACE(l.gddl_tier, 'Tier ', '') AS INTEGER) >= 20))
      GROUP BY LOWER(r.player_name)`,
  ).all() as { k: string; n: number }[]).forEach((r) => extremesMap.set(r.k, r.n))

  const sheet = db
    .prepare(
      `SELECT name AS player, country, total_points AS points, skill_points, hardest, tier
       FROM players`,
    )
    .all() as Omit<Row, 'badge' | 'extremes'>[]

  // Players who have accepted records but no row on the sheet's leaderboard
  // tab — their stats are derived from those records.
  const derived: Omit<Row, 'badge' | 'extremes'>[] = listDerivedPlayers(db).map((d) => ({
    player: d.name,
    country: null,
    points: d.total_points,
    skill_points: d.skill_points,
    hardest: d.hardest,
    tier: d.tier,
  }))

  const seen = new Set<string>()
  for (const r of [...sheet, ...derived]) seen.add(r.player.toLowerCase())

  // Accounts that aren't represented anywhere above (no claim on the sheet
  // and no records under their username). Surfaced here as zero-point rows
  // so search can find them, even though they wouldn't normally rank.
  const accounts = db.prepare(
    `SELECT username, claimed_player, country
       FROM accounts
      WHERE banned_at IS NULL`,
  ).all() as { username: string; claimed_player: string | null; country: string | null }[]

  const accountRows: Omit<Row, 'badge' | 'extremes'>[] = []
  for (const a of accounts) {
    const name = a.claimed_player ?? a.username
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    accountRows.push({
      player: name,
      country: a.country,
      points: 0,
      skill_points: 0,
      hardest: null,
      tier: null,
    })
  }

  const all: Row[] = [...sheet, ...derived, ...accountRows].map((p) => ({
    ...p,
    extremes: extremesMap.get(p.player.toLowerCase()) ?? 0,
    badge: roleMap.get(p.player.toLowerCase()) ?? null,
  }))

  all.sort((a, b) => {
    const dp = (b.points ?? 0) - (a.points ?? 0)
    if (dp !== 0) return dp
    return a.player.localeCompare(b.player, undefined, { sensitivity: 'base' })
  })

  baseCache = { at: Date.now(), rows: all }
  return respond(db, event, all, { limit, offset, search, followedOnly })
})

type RespondOpts = { limit: number; offset: number; search: string; followedOnly: boolean }

/**
 * Filter, rank and page the base set for this specific caller. Split out so
 * the cached and freshly-built paths can't drift apart. Nothing here mutates
 * `all` — the ranked rows are new objects, so the cache stays clean.
 */
function respond(db: ReturnType<typeof getDb>, event: any, all: Row[], opts: RespondOpts) {
  const { limit, offset, search, followedOnly } = opts
  let filtered: Row[] = all

  if (followedOnly) {
    const me = getCurrentAccount(event)
    if (!me) return { total: 0, items: [] }
    const follows = db.prepare(
      `SELECT target_name FROM follows WHERE follower_account_id = ?`,
    ).all(me.id) as { target_name: string }[]
    const followSet = new Set(follows.map((f) => f.target_name.toLowerCase()))
    filtered = filtered.filter((r) => followSet.has(r.player.toLowerCase()))
  }

  if (search) {
    const needle = search.toLowerCase()
    filtered = filtered.filter((r) => r.player.toLowerCase().includes(needle))
  }

  // Ranks reflect position within the filtered/searched results, ordered by
  // points, so the top result in a search is always shown as #1. Only the
  // requested page is materialised — mapping 50k rows to add a rank number
  // just to slice 200 of them was most of the cost of a page turn.
  const total = filtered.length
  const items = filtered.slice(offset, offset + limit).map((p, i) => ({
    rank: offset + i + 1,
    ...p,
    account_username: null as string | null,
    has_avatar: false,
    /**
     * A picture for a player with no account here. Null whenever `has_avatar`
     * is true — the site's own avatar is the answer then, and sending both
     * would invite a client to pick the wrong one.
     */
    aredl_avatar_url: null as string | null,
    clan: null as ClanBadge | null,
  }))

  // Attach the site account behind each name on this page only — the full set
  // is tens of thousands of rows and the avatars are only ever rendered for
  // what's on screen.
  const names = items.map((p) => p.player)
  if (names.length) {
    const ph = names.map(() => '?').join(',')
    const accs = db.prepare(
      `SELECT username, claimed_player, (avatar_blob IS NOT NULL) AS has_avatar
         FROM accounts
        WHERE banned_at IS NULL
          AND (username COLLATE NOCASE IN (${ph}) OR claimed_player COLLATE NOCASE IN (${ph}))`,
    ).all(...names, ...names) as { username: string; claimed_player: string | null; has_avatar: number }[]
    const byName = new Map<string, { username: string; has_avatar: boolean }>()
    for (const a of accs) {
      const entry = { username: a.username, has_avatar: !!a.has_avatar }
      byName.set(a.username.toLowerCase(), entry)
      if (a.claimed_player) byName.set(a.claimed_player.toLowerCase(), entry)
    }
    for (const p of items) {
      const hit = byName.get(p.player.toLowerCase())
      p.account_username = hit?.username ?? null
      p.has_avatar = hit?.has_avatar ?? false
    }

    /**
     * Faces for the rest of the page, from AREDL.
     *
     * Asked for only the rows that still have none — an account's own avatar is
     * always the right picture and this must never override it — so a page
     * where everyone has signed up costs one query that returns nothing.
     */
    const faceless = items.filter((p) => !p.has_avatar).map((p) => p.player)
    if (faceless.length) {
      const aredlFaces = aredlAvatarsForPlayers(db, faceless)
      if (aredlFaces.size) {
        for (const p of items) {
          if (p.has_avatar) continue
          p.aredl_avatar_url = aredlFaces.get(p.player.toLowerCase()) ?? null
        }
      }
    }

    // The clan tag rides along with the account, for the same reason and at the
    // same cost: one query for the page rather than one per row.
    const clans = clanTagsForPlayers(db, names)
    if (clans.size) for (const p of items) p.clan = clans.get(p.player.toLowerCase()) ?? null
  }

  return { total, items }
}

import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'

/**
 * Find a player from the community hub.
 *
 * Players on this site exist in five places at once: site accounts, the ALL
 * list's own record holders, and the AREDL / Pointercrate / GDL mirrors. A
 * search that only knew about one of them would answer "no such player" for
 * most of the names anybody actually types, so this asks all five and merges
 * the answers into one row per person.
 *
 * Merging is by name, case-insensitively, with a claimed account winning:
 * someone who has claimed their leaderboard name should be found once, as
 * themselves, and link to their profile rather than to a mirror row.
 */
type Source = 'account' | 'all' | 'aredl' | 'pointercrate' | 'gdl'

type Hit = {
  name: string
  /** Where the row's profile link goes. */
  href: string
  /** Every list this player was found on, best first. */
  sources: Source[]
  username: string | null
  has_avatar: boolean
  country: string | null
  points: number | null
  rank: number | null
  hardest: string | null
  role: string | null
}

const PER_SOURCE = 25

export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  if (q.length < 2) return { items: [], query: q }
  const limit = Math.max(1, Math.min(40, Number(getQuery(event).limit) || 20))
  const like = `%${q}%`

  const db = getDb()
  const byKey = new Map<string, Hit>()

  /**
   * Fold a row into the merged set. The first source to claim a name owns the
   * link and the identity; later ones only fill in blanks and add their chip,
   * so the calling order below is the precedence order.
   */
  const add = (hit: Hit) => {
    const key = hit.name.toLowerCase()
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, hit); return }
    for (const s of hit.sources) if (!existing.sources.includes(s)) existing.sources.push(s)
    existing.points ??= hit.points
    existing.rank ??= hit.rank
    existing.hardest ??= hit.hardest
    existing.country ??= hit.country
  }

  // 1. Site members — the only rows that are people here rather than elsewhere.
  const accounts = db.prepare(
    `SELECT username, claimed_player, country, role,
            (avatar_blob IS NOT NULL) AS has_avatar
       FROM accounts
      WHERE banned_at IS NULL
        AND (username LIKE ? COLLATE NOCASE OR claimed_player LIKE ? COLLATE NOCASE)
      ORDER BY username COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(like, like, PER_SOURCE) as Array<{
    username: string; claimed_player: string | null; country: string | null
    role: string; has_avatar: number
  }>
  for (const a of accounts) {
    const hit: Hit = {
      name: a.claimed_player || a.username,
      href: `/users/${encodeURIComponent(a.username)}`,
      sources: ['account'],
      username: a.username,
      has_avatar: !!a.has_avatar,
      country: a.country ?? null,
      points: null, rank: null, hardest: null,
      role: a.role,
    }
    add(hit)
    // An account whose claimed player name differs from its username should be
    // findable by either, but must not appear as two people.
    if (a.claimed_player && a.claimed_player.toLowerCase() !== a.username.toLowerCase()) {
      byKey.set(a.username.toLowerCase(), hit)
    }
  }

  // 2. The ALL list's own record holders.
  const players = db.prepare(
    `SELECT p.name, p.country, p.total_points, p.hardest,
            (SELECT username FROM accounts a
              WHERE a.banned_at IS NULL AND a.claimed_player = p.name COLLATE NOCASE
              LIMIT 1) AS username
       FROM players p
      WHERE p.name LIKE ? COLLATE NOCASE
      ORDER BY p.total_points DESC, p.name COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(like, PER_SOURCE) as Array<{
    name: string; country: string | null; total_points: number | null
    hardest: string | null; username: string | null
  }>
  for (const p of players) {
    add({
      name: p.name,
      href: p.username
        ? `/users/${encodeURIComponent(p.username)}`
        : `/users/by-player/${encodeURIComponent(p.name)}`,
      sources: ['all'],
      username: p.username,
      has_avatar: false,
      country: p.country ?? null,
      points: p.total_points ?? null,
      rank: null,
      hardest: p.hardest ?? null,
      role: null,
    })
  }

  // 3-5. The mirrors, in the order the leaderboard ranks them.
  const aredl = db.prepare(
    `SELECT uuid, global_name, username, country, total_points, rank, hardest_name
       FROM aredl_players
      WHERE global_name LIKE ? COLLATE NOCASE OR username LIKE ? COLLATE NOCASE
      ORDER BY rank ASC, global_name COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(like, like, PER_SOURCE) as Array<{
    uuid: string; global_name: string | null; username: string | null
    country: number | null; total_points: number | null; rank: number | null; hardest_name: string | null
  }>
  for (const r of aredl) {
    add({
      name: r.global_name || r.username || '(unnamed)',
      href: `/aredl-players/${encodeURIComponent(r.uuid)}`,
      sources: ['aredl'],
      username: null,
      has_avatar: false,
      country: countryNumericToAlpha2(r.country),
      points: r.total_points ?? null,
      rank: r.rank ?? null,
      hardest: r.hardest_name ?? null,
      role: null,
    })
  }

  const pc = db.prepare(
    `SELECT pc_id, name, nationality, score, rank, hardest_name
       FROM pointercrate_players
      WHERE name LIKE ? COLLATE NOCASE AND banned = 0
      ORDER BY rank ASC, name COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(like, PER_SOURCE) as Array<{
    pc_id: number; name: string; nationality: string | null
    score: number | null; rank: number | null; hardest_name: string | null
  }>
  for (const r of pc) {
    add({
      name: r.name,
      href: `/pointercrate-players/${r.pc_id}`,
      sources: ['pointercrate'],
      username: null,
      has_avatar: false,
      country: r.nationality ?? null,
      points: r.score ?? null,
      rank: r.rank ?? null,
      hardest: r.hardest_name ?? null,
      role: null,
    })
  }

  const gdl = db.prepare(
    `SELECT gdl_id, username, country, points, placement, hardest_name
       FROM gdl_players
      WHERE username LIKE ? COLLATE NOCASE AND is_banned = 0
      ORDER BY placement ASC, username COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(like, PER_SOURCE) as Array<{
    gdl_id: number; username: string; country: string | null
    points: number | null; placement: number | null; hardest_name: string | null
  }>
  for (const r of gdl) {
    add({
      name: r.username,
      href: `/gdl-players/${r.gdl_id}`,
      sources: ['gdl'],
      username: null,
      has_avatar: false,
      country: r.country ?? null,
      points: r.points ?? null,
      rank: r.placement ?? null,
      hardest: r.hardest_name ?? null,
      role: null,
    })
  }

  // Exact matches first, then site members, then by points. Someone typing a
  // full name wants that person at the top even if they have no points here.
  const needle = q.toLowerCase()
  const items = [...byKey.values()]
    .filter((h, i, arr) => arr.findIndex((o) => o === h) === i)
    .sort((a, b) => {
      const aExact = a.name.toLowerCase() === needle ? 0 : 1
      const bExact = b.name.toLowerCase() === needle ? 0 : 1
      if (aExact !== bExact) return aExact - bExact
      const aMember = a.sources.includes('account') ? 0 : 1
      const bMember = b.sources.includes('account') ? 0 : 1
      if (aMember !== bMember) return aMember - bMember
      const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1
      const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1
      if (aStarts !== bStarts) return aStarts - bStarts
      return (b.points ?? -1) - (a.points ?? -1)
    })
    .slice(0, limit)

  return { items, query: q }
})

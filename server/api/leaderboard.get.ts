import { getDb } from '~/server/db'
import { listDerivedPlayers } from '~/server/utils/leaderboard'
import { getCurrentAccount } from '~/server/utils/auth'

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

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.min(2000, Math.max(1, Number(q.limit) || 100))
  const offset = Math.max(0, Number(q.offset) || 0)
  const search = String(q.q ?? '').trim()
  const followedOnly = String(q.followed ?? '') === '1'

  const db = getDb()
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

  let filtered = [...all]

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
  // points, so the top result in a search is always shown as #1.
  const ranked = filtered.map((p, i) => ({ rank: i + 1, ...p }))
  const total = ranked.length
  const items = ranked.slice(offset, offset + limit)
  return { total, items }
})

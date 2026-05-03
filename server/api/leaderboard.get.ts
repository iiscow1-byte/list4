import { getDb } from '~/server/db'
import { listDerivedPlayers } from '~/server/utils/leaderboard'
import { getCurrentAccount } from '~/server/utils/auth'

type Row = {
  player: string
  country: string | null
  points: number
  skill_points: number
  hardest: string | null
  tier: string | null
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100))
  const search = String(q.q ?? '').trim()
  const followedOnly = String(q.followed ?? '') === '1'

  const db = getDb()
  const sheet = db
    .prepare(
      `SELECT name AS player, country, total_points AS points, skill_points, hardest, tier
       FROM players`,
    )
    .all() as Row[]

  // Players who have accepted records but no row on the sheet's leaderboard
  // tab — their stats are derived from those records.
  const derived: Row[] = listDerivedPlayers(db).map((d) => ({
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

  const accountRows: Row[] = []
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

  let all = [...sheet, ...derived, ...accountRows].sort((a, b) => {
    const dp = (b.points ?? 0) - (a.points ?? 0)
    if (dp !== 0) return dp
    return a.player.localeCompare(b.player, undefined, { sensitivity: 'base' })
  })

  // Rank is assigned BEFORE filtering so a searched/followed view still shows
  // each player's true global rank, not their position within the filtered list.
  let ranked = all.map((p, i) => ({ rank: i + 1, ...p }))

  if (followedOnly) {
    const me = getCurrentAccount(event)
    if (!me) return { total: 0, items: [] }
    const follows = db.prepare(
      `SELECT target_name FROM follows WHERE follower_account_id = ?`,
    ).all(me.id) as { target_name: string }[]
    const followSet = new Set(follows.map((f) => f.target_name.toLowerCase()))
    ranked = ranked.filter((r) => followSet.has(r.player.toLowerCase()))
  }

  if (search) {
    const needle = search.toLowerCase()
    ranked = ranked.filter((r) => r.player.toLowerCase().includes(needle))
  }

  const total = ranked.length
  const items = ranked.slice(0, limit)
  return { total, items }
})

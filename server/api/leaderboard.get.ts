import { getDb } from '~/server/db'
import { listDerivedPlayers } from '~/server/utils/leaderboard'

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

  const all = [...sheet, ...derived].sort((a, b) => {
    const dp = (b.points ?? 0) - (a.points ?? 0)
    if (dp !== 0) return dp
    return a.player.localeCompare(b.player, undefined, { sensitivity: 'base' })
  })

  const total = all.length
  const items = all.slice(0, limit).map((p, i) => ({ rank: i + 1, ...p }))
  return { total, items }
})

import { getDb, pointsForPosition } from '~/server/db'

type Cached = { at: number; data: unknown }
let cache: Cached | null = null
const TTL_MS = 30_000

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100))

  if (cache && Date.now() - cache.at < TTL_MS) return sliced(cache.data, limit)

  const db = getDb()
  const listSize = (db.prepare('SELECT COUNT(*) AS n FROM levels').get() as { n: number }).n

  // For each verified 100% record, award points based on the level's position.
  const rows = db
    .prepare(
      `SELECT p.id   AS player_id,
              p.name AS player,
              p.country,
              l.position
       FROM records r
       JOIN levels  l ON l.id = r.level_id
       JOIN players p ON p.id = r.player_id
       WHERE r.verified = 1 AND r.percent = 100`,
    )
    .all() as { player_id: number; player: string; country: string | null; position: number }[]

  type Agg = { player_id: number; player: string; country: string | null; points: number; completed: number }
  const byPlayer = new Map<number, Agg>()
  for (const row of rows) {
    const pts = pointsForPosition(row.position, { listSize })
    if (pts <= 0) continue
    const cur = byPlayer.get(row.player_id) ?? { player_id: row.player_id, player: row.player, country: row.country, points: 0, completed: 0 }
    cur.points += pts
    cur.completed += 1
    byPlayer.set(row.player_id, cur)
  }
  const ranked = [...byPlayer.values()]
    .sort((a, b) => b.points - a.points || b.completed - a.completed || a.player.localeCompare(b.player))
    .map((p, i) => ({ rank: i + 1, ...p, points: Math.round(p.points * 100) / 100 }))

  cache = { at: Date.now(), data: ranked }
  return sliced(ranked, limit)
})

function sliced(data: unknown, limit: number) {
  const arr = data as any[]
  return { total: arr.length, items: arr.slice(0, limit) }
}

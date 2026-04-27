import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100))

  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n
  const items = db
    .prepare(
      `SELECT name AS player, country, total_points AS points, skill_points, hardest, tier
       FROM players
       ORDER BY total_points DESC, name COLLATE NOCASE ASC
       LIMIT ?`,
    )
    .all(limit)
    .map((p, i) => ({ rank: i + 1, ...(p as object) }))

  return { total, items }
})

import { getDb } from '~/server/db'

/**
 * Suggest matching record-holder names — leaderboard players first (ranked by
 * total points), then accounts that aren't already represented by a player row.
 * Used by the record-submission form's holder autocomplete.
 */
export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  if (q.length === 0) return { items: [] }

  const limit = Math.min(20, Math.max(1, Number(getQuery(event).limit) || 10))
  const pattern = `%${q}%`

  const db = getDb()
  const players = db.prepare(
    `SELECT name FROM players
      WHERE name LIKE ? COLLATE NOCASE
      ORDER BY total_points DESC, name COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(pattern, limit) as { name: string }[]

  const seen = new Set(players.map((p) => p.name.toLowerCase()))
  const accounts = (db.prepare(
    `SELECT username AS name FROM accounts
      WHERE username LIKE ? COLLATE NOCASE
      ORDER BY username COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(pattern, limit) as { name: string }[]).filter((a) => !seen.has(a.name.toLowerCase()))

  const items = [
    ...players.map((p) => ({ name: p.name, source: 'player' as const })),
    ...accounts.map((a) => ({ name: a.name, source: 'account' as const })),
  ].slice(0, limit)

  return { items }
})

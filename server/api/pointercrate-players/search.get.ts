import { getDb } from '~/server/db'

/**
 * Lightweight name autocomplete for the Pointercrate claim flow.
 * Banned players excluded — they can't be claimed.
 */
export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  if (!q) return { items: [] }
  const db = getDb()
  const like = `%${q}%`
  const rows = db.prepare(
    `SELECT pc_id, name, nationality, score, claimed_account_id
       FROM pointercrate_players
      WHERE name LIKE ? COLLATE NOCASE
        AND banned = 0
   ORDER BY (CASE WHEN name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END),
            score DESC
      LIMIT 20`,
  ).all(like, `${q}%`)
  return { items: rows }
})

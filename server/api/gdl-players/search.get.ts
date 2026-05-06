import { getDb } from '~/server/db'

/**
 * Lightweight name autocomplete for the GDL claim flow.
 * Banned players excluded — they can't be claimed.
 */
export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  if (!q) return { items: [] }
  const db = getDb()
  const like = `%${q}%`
  const rows = db.prepare(
    `SELECT gdl_id, username AS name, country, points, claimed_account_id
       FROM gdl_players
      WHERE username LIKE ? COLLATE NOCASE
        AND is_banned = 0
   ORDER BY (CASE WHEN username LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END),
            points DESC
      LIMIT 20`,
  ).all(like, `${q}%`)
  return { items: rows }
})

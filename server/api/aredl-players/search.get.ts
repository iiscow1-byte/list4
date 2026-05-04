import { getDb } from '~/server/db'

/**
 * Lightweight name autocomplete for the AREDL claim flow. Top matches by
 * (name prefix > name contains > points desc).
 */
export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  if (!q) return { items: [] }
  const db = getDb()
  const like = `%${q}%`
  const rows = db.prepare(
    `SELECT uuid, global_name, username, country, total_points, claimed_account_id
       FROM aredl_players
      WHERE global_name LIKE ? COLLATE NOCASE
         OR username    LIKE ? COLLATE NOCASE
   ORDER BY (CASE WHEN global_name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END),
            total_points DESC
      LIMIT 20`,
  ).all(like, like, `${q}%`)
  return { items: rows }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const items = db
    .prepare(
      `SELECT w.id, w.url, w.label, w.active, w.tier_emoji, w.created_at,
              w.last_posted_date, w.last_post_status,
              a.username AS created_by
         FROM discord_webhooks w
         LEFT JOIN accounts a ON a.id = w.created_by
        ORDER BY w.created_at DESC`,
    )
    .all()
  return { items }
})

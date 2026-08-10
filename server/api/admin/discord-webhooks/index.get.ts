import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { maskWebhookUrl } from '~/server/utils/webhook-mask'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const items = db
    .prepare(
      `SELECT w.id, w.url, w.label, w.active, w.tier_emoji, w.split_long, w.kind,
              w.created_at, w.last_posted_date, w.last_post_status,
              a.username AS created_by
         FROM discord_webhooks w
         LEFT JOIN accounts a ON a.id = w.created_by
        ORDER BY w.created_at DESC`,
    )
    .all() as any[]

  // Masked on the way out. The panel only ever needs to tell two hooks apart;
  // the trailing segment is a write credential for the channel and stays
  // server-side, which is the rule the custom-list webhooks already follow.
  return { items: items.map((w) => ({ ...w, url: maskWebhookUrl(w.url) })) }
})

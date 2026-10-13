import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { maskWebhookUrl } from '~/server/utils/webhook-mask'
import { dailyScheduleState, queuedDigest } from '~/server/utils/daily-discord'
import { SITE_URL } from '~/server/utils/discord'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const items = db
    .prepare(
      `SELECT w.id, w.url, w.label, w.active, w.tier_emoji, w.split_long, w.kind,
              w.created_at, w.last_posted_date, w.last_post_status, w.posted_through,
              w.mention_role_id, w.discord_name, w.channel_id, w.guild_id,
              w.paused_reason, w.last_success_at,
              a.username AS created_by,
              (SELECT COUNT(*) FROM discord_deliveries d
                WHERE d.webhook_id = w.id AND d.ok = 0 AND d.at > datetime('now', '-7 days')) AS failures_7d
         FROM discord_webhooks w
         LEFT JOIN accounts a ON a.id = w.created_by
        ORDER BY w.created_at DESC`,
    )
    .all() as any[]

  // Midnight UTC; the scheduler checks every ten minutes, so the post lands
  // within ten minutes of it.
  const now = new Date()
  const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

  // Masked on the way out. The panel only ever needs to tell two hooks apart;
  // the trailing segment is a write credential for the channel and stays
  // server-side, which is the rule the custom-list webhooks already follow.
  return {
    items: items.map((w) => ({
      ...w,
      url: maskWebhookUrl(w.url),
      // What the next digest would carry, so "Post now" is never a guess.
      queued_changes: w.kind === 'changes' || w.kind === 'challenge_changes'
        ? queuedDigest(db, w.id)?.changes ?? 0
        : null,
    })),
    schedule: { ...dailyScheduleState(), next_run_at: nextMidnight.toISOString() },
    site_url_set: !!SITE_URL,
  }
})

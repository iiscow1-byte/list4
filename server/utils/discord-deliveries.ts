import type { DatabaseSync } from 'node:sqlite'
import type { PostStatus } from '~/server/utils/discord'

/**
 * What happened to each post, per webhook.
 *
 * `last_post_status` only ever held the newest outcome, so a record post that
 * failed at noon was overwritten by the digest that worked at midnight and
 * nobody could tell it had been lost. This keeps the last 50 sends per webhook.
 */

const KEEP_PER_WEBHOOK = 50

export const GONE_REASON = 'Discord says this webhook no longer exists. It was deleted or its URL was reset.'

export function recordDelivery(
  db: DatabaseSync,
  webhookId: number,
  what: string,
  res: Pick<PostStatus, 'ok' | 'status' | 'gone'>,
  messages = 1,
): void {
  db.prepare(
    `INSERT INTO discord_deliveries (webhook_id, what, ok, status, messages) VALUES (?, ?, ?, ?, ?)`,
  ).run(webhookId, what.slice(0, 200), res.ok ? 1 : 0, res.status.slice(0, 300), messages)
  db.prepare(
    `DELETE FROM discord_deliveries
      WHERE webhook_id = ?
        AND id NOT IN (SELECT id FROM discord_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?)`,
  ).run(webhookId, webhookId, KEEP_PER_WEBHOOK)

  if (res.ok) {
    db.prepare(`UPDATE discord_webhooks SET last_success_at = datetime('now') WHERE id = ?`).run(webhookId)
  } else if (res.gone) {
    // Posting to it again can only fail. Paused rather than deleted, so the
    // admin sees why it went quiet and can paste a new URL into the same row.
    db.prepare(`UPDATE discord_webhooks SET active = 0, paused_reason = ? WHERE id = ?`).run(GONE_REASON, webhookId)
  }
}

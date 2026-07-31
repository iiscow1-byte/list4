import type { DatabaseSync } from 'node:sqlite'
import { isValidDiscordWebhook } from './discord'

/**
 * Per-list Discord webhooks. Distinct from the site-wide ones in
 * `server/utils/discord.ts`: these belong to a list owner and fire only on
 * that list's own events.
 *
 * Every send is fire-and-forget. A list owner's broken webhook must never turn
 * into a failed record submission for someone else, so callers `.catch()` and
 * failures are recorded on the row instead of thrown.
 */
export type ListWebhookEvent = 'changes' | 'records' | 'submissions'

const COLUMN: Record<ListWebhookEvent, string> = {
  changes: 'on_changes',
  records: 'on_records',
  submissions: 'on_submissions',
}

export type ListEmbed = {
  title: string
  description: string
  /** Discord colour int; defaults to the site accent. */
  color?: number
  url?: string
}

export async function notifyListWebhooks(
  db: DatabaseSync,
  listId: number,
  event: ListWebhookEvent,
  embed: ListEmbed,
): Promise<void> {
  const hooks = db.prepare(
    `SELECT id, url FROM custom_list_webhooks
      WHERE list_id = ? AND active = 1 AND ${COLUMN[event]} = 1`,
  ).all(listId) as { id: number; url: string }[]
  if (!hooks.length) return

  const payload = {
    embeds: [{
      title: embed.title.slice(0, 256),
      description: embed.description.slice(0, 4000),
      color: embed.color ?? 0xf4c430,
      url: embed.url,
      timestamp: new Date().toISOString(),
    }],
  }

  const setStatus = db.prepare(`UPDATE custom_list_webhooks SET last_status = ? WHERE id = ?`)

  await Promise.all(hooks.map(async (h) => {
    try {
      const res = await fetch(h.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      })
      setStatus.run(res.ok ? 'ok' : `HTTP ${res.status}`, h.id)
    } catch (err: any) {
      setStatus.run(String(err?.message ?? 'failed').slice(0, 120), h.id)
    }
  }))
}

export { isValidDiscordWebhook }

import type { DatabaseSync } from 'node:sqlite'
import { SITE_URL, levelThumbnail, postToDiscordWebhook, siteFooter } from '~/server/utils/discord'

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
  /** Discord colour int; defaults to the list's own colour. */
  color?: number
  url?: string
  /** The level the post is about, for its thumbnail. */
  gdId?: number | null
}

/** "#22d3ee" as the integer Discord wants, or null. */
function colorInt(hex: string | null | undefined): number | null {
  const m = (hex ?? '').trim().match(/^#?([0-9a-f]{6})$/i)
  return m ? parseInt(m[1]!, 16) : null
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

  // The list's own name, icon and colour head its posts.
  const list = db.prepare(`SELECT title, public_id, icon_url, accent_color FROM custom_lists WHERE id = ?`).get(listId) as
    { title: string; public_id: string; icon_url: string | null; accent_color: string | null } | undefined
  const listUrl = list && SITE_URL ? `${SITE_URL}/lists/${list.public_id}` : undefined

  const payload = {
    // List names, level names and player names are user text; never ping.
    allowed_mentions: { parse: [] },
    embeds: [{
      author: list ? {
        name: list.title.slice(0, 256),
        url: listUrl,
        icon_url: list.icon_url && /^https:\/\//.test(list.icon_url) ? list.icon_url : undefined,
      } : undefined,
      title: embed.title.slice(0, 256),
      description: embed.description.slice(0, 4000),
      color: embed.color ?? colorInt(list?.accent_color) ?? 0xf4c430,
      url: embed.url ?? listUrl,
      thumbnail: levelThumbnail(embed.gdId),
      footer: siteFooter('All Levels List · custom lists'),
      timestamp: new Date().toISOString(),
    }],
  }

  const setStatus = db.prepare(`UPDATE custom_list_webhooks SET last_status = ? WHERE id = ?`)

  // The shared sender waits out a short rate limit instead of dropping the post.
  await Promise.all(hooks.map(async (h) => {
    const res = await postToDiscordWebhook(h.url, payload, 8000)
    setStatus.run(res.ok ? 'ok' : res.status.slice(0, 120), h.id)
  }))
}


import { getDb } from '~/server/db'
import { groupByDay, loadChanges } from '~/server/utils/changes'
import { buildDailyEmbed, postToDiscordWebhook } from '~/server/utils/discord'

/** YYYY-MM-DD for `date` in UTC. */
function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Today's UTC date, minus N days, as YYYY-MM-DD. */
function ymdUtcMinusDays(days: number): string {
  return ymdUtc(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
}

export type WebhookRow = {
  id: number
  url: string
  active: number
  last_posted_date: string | null
}

/**
 * For each active webhook, post yesterday's changes (or any prior unposted
 * day, up to a small backlog) and update its last_posted_date. Designed to
 * be called from a cron tick — safe to run frequently because of the
 * date-comparison guard.
 */
export async function postDailyChangesIfDue(): Promise<{
  posted: { webhookId: number; date: string; status: string }[]
}> {
  const db = getDb()
  const yesterday = ymdUtcMinusDays(1)

  const webhooks = db
    .prepare(`SELECT id, url, active, last_posted_date FROM discord_webhooks WHERE active = 1`)
    .all() as WebhookRow[]
  if (!webhooks.length) return { posted: [] }

  const posted: { webhookId: number; date: string; status: string }[] = []

  for (const wh of webhooks) {
    // Catch up from `last_posted_date + 1` to yesterday — but cap at 7 days
    // back so a long outage doesn't dump weeks of posts.
    const earliest = ymdUtcMinusDays(7)
    let cursor = wh.last_posted_date
      ? incrementDate(wh.last_posted_date)
      : yesterday
    if (cursor < earliest) cursor = earliest

    while (cursor <= yesterday) {
      const status = await postOneDay(wh, cursor)
      posted.push({ webhookId: wh.id, date: cursor, status })
      // Always advance the cursor on a definitive outcome so a permanently
      // bad URL doesn't loop forever.
      db.prepare(
        `UPDATE discord_webhooks SET last_posted_date = ?, last_post_status = ? WHERE id = ?`,
      ).run(cursor, status, wh.id)
      cursor = incrementDate(cursor)
    }
  }

  return { posted }
}

/** Post a specific UTC day's changes to a single webhook. Returns status. */
export async function postOneDay(wh: WebhookRow, date: string): Promise<string> {
  const db = getDb()
  const since = `${date} 00:00:00`
  const until = `${date} 23:59:59`
  // Pull oldest-first so the embed reads chronologically.
  const changes = loadChanges(db, { since, until, limit: 1000 }).reverse()
  const payload = buildDailyEmbed(date, changes)
  if (!payload) return 'no changes'
  return postToDiscordWebhook(wh.url, payload)
}

function incrementDate(ymd: string): string {
  // YYYY-MM-DD -> next UTC day's YYYY-MM-DD.
  const [y, m, d] = ymd.split('-').map(Number)
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1))
  return next.toISOString().slice(0, 10)
}

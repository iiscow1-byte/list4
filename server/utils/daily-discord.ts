import { getDb } from '~/server/db'
import { groupByDay, loadChanges } from '~/server/utils/changes'
import { buildDailyEmbeds, buildChallengeEmbeds, postToDiscordWebhook } from '~/server/utils/discord'

/** YYYY-MM-DD for `date` in UTC. */
export function ymdUtc(date: Date): string {
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
  tier_emoji: number
  /** 1 = send the whole day across as many messages as it takes. */
  split_long?: number
}

/**
 * For each active webhook, post yesterday's changes (or any prior unposted
 * day, up to a small backlog) and update its last_posted_date. Designed to
 * be called from a cron tick — safe to run frequently because of the
 * date-comparison guard.
 */
export async function postDailyChangesIfDue(opts: { upToDate?: string; forceCurrent?: boolean; allWebhooks?: boolean } = {}): Promise<{
  posted: { webhookId: number; date: string; status: string }[]
}> {
  const db = getDb()
  const today = ymdUtc(new Date())
  const upToDate = opts.upToDate ?? ymdUtcMinusDays(1)

  // allWebhooks: manual "post now" should reach paused webhooks too. The
  // `active` flag gates the automated scheduler only.
  const webhooks = db
    .prepare(opts.allWebhooks
      ? `SELECT id, url, active, last_posted_date, tier_emoji, kind, split_long FROM discord_webhooks WHERE kind IN ('changes','challenge_changes')`
      : `SELECT id, url, active, last_posted_date, tier_emoji, kind, split_long FROM discord_webhooks WHERE active = 1 AND kind IN ('changes','challenge_changes')`)
    .all() as (WebhookRow & { kind: string })[]
  if (!webhooks.length) return { posted: [] }

  const posted: { webhookId: number; date: string; status: string }[] = []

  for (const wh of webhooks) {
    // Catch up from `last_posted_date + 1` to upToDate — but cap at 7 days
    // back so a long outage doesn't dump weeks of posts.
    const earliest = ymdUtcMinusDays(7)
    let cursor = wh.last_posted_date
      ? incrementDate(wh.last_posted_date)
      : upToDate
    if (cursor < earliest) cursor = earliest

    // forceCurrent: if the cursor has already advanced past upToDate (because
    // last_posted_date >= upToDate), reset it so the current day is always
    // re-posted on manual "post now" triggers.
    if (opts.forceCurrent && cursor > upToDate) cursor = upToDate

    while (cursor <= upToDate) {
      const status = await postOneDay(wh, cursor)
      posted.push({ webhookId: wh.id, date: cursor, status })
      // Only advance last_posted_date for completed (past) days, not today.
      // Storing today as last_posted_date would cause the next scheduled run
      // to start from tomorrow, skipping yesterday entirely.
      if (cursor < today) {
        db.prepare(
          `UPDATE discord_webhooks SET last_posted_date = ?, last_post_status = ? WHERE id = ?`,
        ).run(cursor, status, wh.id)
      } else {
        db.prepare(
          `UPDATE discord_webhooks SET last_post_status = ? WHERE id = ?`,
        ).run(status, wh.id)
      }
      cursor = incrementDate(cursor)
    }
  }

  return { posted }
}

/**
 * Post a specific UTC day's changes to a single webhook. Returns status.
 *
 * A day can be more than one message — see `buildDailyEmbeds`. They go in
 * order, with a short pause between them: Discord's per-webhook rate limit is
 * generous but real, and a day that needs six messages would otherwise send
 * them in the same instant. The first failure stops the rest, since posting
 * pages 4–6 of something whose page 3 never arrived is worse than stopping.
 */
export async function postOneDay(wh: WebhookRow & { kind?: string; split_long?: number }, date: string): Promise<string> {
  const db = getDb()
  const since = `${date} 00:00:00`
  const until = `${date} 23:59:59`
  // Pull oldest-first so the embed reads chronologically. Native moves only —
  // imported AREDL history rows carry historical dates and would flood the
  // digest if a backfill ran that day.
  const changes = loadChanges(db, { since, until, limit: 1000, source: 'all' }).reverse()
  const split = !!wh.split_long

  const payloads = wh.kind === 'challenge_changes'
    ? buildChallengeEmbeds(date, changes, { split })
    : buildDailyEmbeds(date, changes, { tierEmoji: !!wh.tier_emoji, split })

  if (!payloads.length) return 'no changes'

  for (const [i, payload] of payloads.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200))
    const status = await postToDiscordWebhook(wh.url, payload)
    if (status !== 'ok') {
      return payloads.length > 1 ? `${status} (message ${i + 1}/${payloads.length})` : status
    }
  }
  return payloads.length > 1 ? `ok (${payloads.length} messages)` : 'ok'
}

function incrementDate(ymd: string): string {
  // YYYY-MM-DD -> next UTC day's YYYY-MM-DD.
  const [y, m, d] = ymd.split('-').map(Number)
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1))
  return next.toISOString().slice(0, 10)
}

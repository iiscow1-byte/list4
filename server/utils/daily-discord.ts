import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '~/server/db'
import { loadChanges } from '~/server/utils/changes'
import { buildChallengeEmbeds, buildDailyEmbeds, dayLabel, postToDiscordWebhook } from '~/server/utils/discord'

/**
 * The daily changelog digest for `changes` / `challenge_changes` webhooks.
 *
 * Each webhook keeps `posted_through`, a UTC timestamp: every change at or
 * before it has been sent. A run sends the changes after it and moves it
 * forward, so nothing is ever sent twice, whichever of the nightly run or a
 * manual "post now" gets there first.
 *
 * The cursor is claimed (compare-and-swap) before anything is sent, so two
 * processes sharing a database can't both post the same window. If the first
 * message of a window fails in a way worth retrying, the claim is given back
 * and the next tick tries again, up to three times; once anything has been
 * delivered the window is never sent again.
 */

/** Older days than this are skipped rather than flooding a channel after downtime. */
const MAX_CATCH_UP_DAYS = 2
const MAX_ATTEMPTS = 3

type Hook = {
  id: number
  url: string
  kind: string
  tier_emoji: number
  split_long: number
  posted_through: string | null
  fail_count: number
}

export type PostedEntry = { webhookId: number; window: string; status: string }

/** `YYYY-MM-DD HH:MM:SS`, UTC — the format SQLite's `datetime('now')` writes. */
function sqlTs(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function dayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`)
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}

type Window = { after: string; through: string; title: string }

/**
 * The windows a webhook still owes, oldest first.
 *
 * `scheduled`: one window per finished UTC day since the cursor, at most
 * `MAX_CATCH_UP_DAYS` of them. `now`: one window from the cursor to this moment.
 */
function windowsFor(hook: Hook, mode: 'scheduled' | 'now', now = new Date()): Window[] {
  const today = ymd(now)
  const yesterday = ymd(addDays(now, -1))
  const floor = sqlTs(new Date(dayStart(ymd(addDays(now, -MAX_CATCH_UP_DAYS))).getTime() - 1000))
  // A webhook that has never posted starts from the beginning of yesterday.
  let after = hook.posted_through ?? sqlTs(new Date(dayStart(yesterday).getTime() - 1000))
  if (after < floor) after = floor

  if (mode === 'now') {
    const through = sqlTs(now)
    if (after >= through) return []
    return [{ after, through, title: `List changes so far today, ${dayLabel(today)}` }]
  }

  const out: Window[] = []
  for (let d = ymd(addDays(new Date(after.replace(' ', 'T') + 'Z'), 0)); d <= yesterday; d = ymd(addDays(dayStart(d), 1))) {
    const end = sqlTs(new Date(dayStart(d).getTime() + 86_399_000))
    if (end <= after) continue
    const start = sqlTs(new Date(dayStart(d).getTime() - 1000))
    out.push({ after: start > after ? start : after, through: end, title: `List changes, ${dayLabel(d)}` })
  }
  return out
}

function claim(db: DatabaseSync, hook: Hook, from: string | null, to: string | null): boolean {
  const res = db.prepare(
    `UPDATE discord_webhooks SET posted_through = ? WHERE id = ? AND COALESCE(posted_through, '') = COALESCE(?, '')`,
  ).run(to, hook.id, from)
  return Number(res.changes) === 1
}

function setStatus(db: DatabaseSync, hookId: number, status: string, failCount: number, day?: string): void {
  if (day) {
    db.prepare(`UPDATE discord_webhooks SET last_post_status = ?, fail_count = ?, last_posted_date = ? WHERE id = ?`)
      .run(status.slice(0, 300), failCount, day, hookId)
  } else {
    db.prepare(`UPDATE discord_webhooks SET last_post_status = ?, fail_count = ? WHERE id = ?`)
      .run(status.slice(0, 300), failCount, hookId)
  }
}

async function sendWindow(db: DatabaseSync, hook: Hook, w: Window): Promise<{ status: string; stop: boolean }> {
  const before = hook.posted_through
  if (!claim(db, hook, before, w.through)) return { status: 'skipped: already sent elsewhere', stop: true }
  hook.posted_through = w.through

  // `loadChanges` treats `since` as inclusive; timestamps are whole seconds.
  const since = sqlTs(new Date(new Date(w.after.replace(' ', 'T') + 'Z').getTime() + 1000))
  const changes = loadChanges(db, { since, until: w.through, limit: 2000 }).reverse()
  const opts = { tierEmoji: !!hook.tier_emoji, split: !!hook.split_long, through: w.through }
  const payloads = hook.kind === 'challenge_changes'
    ? buildChallengeEmbeds(w.title.replace('List changes', 'Challenge changes'), changes, opts)
    : buildDailyEmbeds(w.title, changes, opts)
  const day = w.through.slice(0, 10)

  if (!payloads.length) {
    setStatus(db, hook.id, 'no changes', 0, day)
    return { status: 'no changes', stop: false }
  }

  for (const [i, payload] of payloads.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200))
    const res = await postToDiscordWebhook(hook.url, payload)
    if (res.ok) continue
    if (i === 0 && res.retryable && hook.fail_count + 1 < MAX_ATTEMPTS) {
      // Nothing reached the channel: hand the window back for the next tick.
      if (claim(db, hook, w.through, before)) hook.posted_through = before
      setStatus(db, hook.id, `will retry: ${res.status}`, hook.fail_count + 1)
      return { status: `retrying (${res.status})`, stop: true }
    }
    const status = i === 0 ? `failed: ${res.status}` : `sent ${i} of ${payloads.length}, then ${res.status}`
    setStatus(db, hook.id, status, 0, day)
    return { status, stop: false }
  }
  const status = payloads.length > 1 ? `ok (${payloads.length} messages)` : 'ok'
  setStatus(db, hook.id, status, 0, day)
  return { status, stop: false }
}

let running = false

/**
 * Send what each webhook is owed.
 *
 * `mode: 'scheduled'` (the timer) sends finished days only. `mode: 'now'` (the
 * admin button) also sends today so far. `includePaused` reaches webhooks whose
 * automatic posting is switched off; `webhookId` limits the run to one.
 */
export async function postDailyChangesIfDue(opts: {
  mode?: 'scheduled' | 'now'
  includePaused?: boolean
  webhookId?: number
} = {}): Promise<{ posted: PostedEntry[] }> {
  if (running) return { posted: [] }
  running = true
  try {
    const db = getDb()
    const mode = opts.mode ?? 'scheduled'
    const where = [`kind IN ('changes', 'challenge_changes')`]
    const params: number[] = []
    if (!opts.includePaused) where.push('active = 1')
    if (opts.webhookId != null) { where.push('id = ?'); params.push(opts.webhookId) }
    const hooks = db.prepare(
      `SELECT id, url, kind, tier_emoji, split_long, posted_through, fail_count
         FROM discord_webhooks WHERE ${where.join(' AND ')}`,
    ).all(...params) as Hook[]

    const posted: PostedEntry[] = []
    for (const hook of hooks) {
      for (const w of windowsFor(hook, mode)) {
        const res = await sendWindow(db, hook, w)
        posted.push({ webhookId: hook.id, window: w.title, status: res.status })
        if (res.stop) break
      }
    }
    return { posted }
  } finally {
    running = false
  }
}

/** For a new or re-enabled webhook: start from now, not from the backlog. */
export function startCursorNow(db: DatabaseSync, webhookId: number): void {
  db.prepare(`UPDATE discord_webhooks SET posted_through = ?, fail_count = 0 WHERE id = ?`).run(sqlTs(new Date()), webhookId)
}

export { windowsFor as _windowsFor }

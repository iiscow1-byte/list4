import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '~/server/db'

/**
 * Counting how much the site is read, without keeping a record of who read it.
 *
 * Two numbers are worth having, and they are **different numbers**: how many
 * pages were opened, and how many people opened them. Everything here exists to
 * produce those two and nothing else. There is no per-request row, no address
 * stored, no account attached to a view. What is kept is a daily count per
 * *shape* of URL, the same split by hour, a daily set of opaque visitor hashes,
 * and running totals per level and per custom list.
 */

/** Today, UTC, as `YYYY-MM-DD`. The whole table keys on this. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The day and the hour, together, so both writes agree about which day it is. */
export function nowParts(): { day: string; hour: number } {
  const d = new Date()
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() }
}

/**
 * A per-install secret, made once and kept.
 *
 * The visitor hash is salted with it so the stored value can't be reproduced
 * from an address and a user agent by anyone who doesn't have the database —
 * and it lives in the database rather than in memory because a restart would
 * otherwise re-salt everything and count every returning reader as new.
 */
function visitorSalt(db: DatabaseSync): string {
  const row = db.prepare(`SELECT value FROM site_meta WHERE key = 'visitor_salt'`)
    .get() as { value: string } | undefined
  if (row?.value) return row.value
  const salt = randomBytes(32).toString('hex')
  db.prepare(`INSERT OR IGNORE INTO site_meta (key, value) VALUES ('visitor_salt', ?)`).run(salt)
  // Re-read: another worker may have won the race, and both must agree.
  const now = db.prepare(`SELECT value FROM site_meta WHERE key = 'visitor_salt'`)
    .get() as { value: string } | undefined
  return now?.value ?? salt
}

/**
 * An opaque, day-scoped identity for one reader.
 *
 * Address and user agent go in, 16 hex characters come out, and the day is part
 * of the input — so the same person tomorrow is a different value and nothing
 * here can be used to follow anyone across days. It is deliberately weak as an
 * identifier and adequate as a counter, which is the trade this is meant to
 * make.
 */
export function visitorHash(db: DatabaseSync, ip: string, userAgent: string, day: string): string {
  return createHash('sha256')
    .update(`${day}|${visitorSalt(db)}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * The same, for the address alone — no user agent.
 *
 * `visitorHash` answers "is this the same person?" and is the right input to a
 * count of people. It is the wrong input to a *throttle*, because the user
 * agent is a request header: anyone refreshing a page with a script that varies
 * it gets a new identity on every request, and every one of those requests
 * counted. Two browsers open on one machine did the same thing by accident.
 *
 * So throttling keys on this instead. It is coarser on purpose — everyone
 * behind one address shares it — and that is the correct direction to err for a
 * ceiling: the cost is under-counting a shared connection, against the
 * alternative of a counter anybody can type into.
 *
 * Salted and day-scoped exactly like the visitor hash, so it is no more of a
 * record of anyone than that is, and it is never written to a table.
 */
export function networkHash(db: DatabaseSync, ip: string, day: string): string {
  return createHash('sha256')
    .update(`${day}|${visitorSalt(db)}|net|${ip}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * The *shape* of a path.
 *
 * `/levels/4021` and `/levels/9` are one page with different contents, and
 * keeping them apart would put a row per level per day in the table for no
 * benefit — per-level numbers are counted separately, against the level's id.
 * Anything unrecognised collapses to `/other`, so a crawler inventing URLs
 * can't grow the table either.
 */
export function normalisePath(rawPath: string): string {
  const path = (rawPath.split('?')[0] ?? '/').replace(/\/+$/, '') || '/'
  const patterns: [RegExp, string][] = [
    [/^\/levels\/submit$/, '/levels/submit'],
    [/^\/levels\/find$/, '/levels/find'],
    [/^\/levels\/\d+$/, '/levels/:position'],
    [/^\/void\/\d+$/, '/void/:position'],
    [/^\/awaiting\/\d+$/, '/awaiting/:position'],
    [/^\/open-verifications\/\d+$/, '/open-verifications/:id'],
    [/^\/opinions\/submit$/, '/opinions/submit'],
    [/^\/records\/submit$/, '/records/submit'],
    [/^\/users\/by-player\/.+$/, '/users/by-player/:player'],
    [/^\/users\/[^/]+$/, '/users/:username'],
    [/^\/clans\/[^/]+$/, '/clans/:tag'],
    [/^\/aredl-players\/[^/]+$/, '/aredl-players/:id'],
    [/^\/gdl-players\/[^/]+$/, '/gdl-players/:id'],
    [/^\/pointercrate-players\/[^/]+$/, '/pointercrate-players/:id'],
    // A custom list's own pages, kept apart from each other but not per list.
    [/^\/lists\/[^/]+\/\d+$/, '/lists/:id/:rank'],
    [/^\/lists\/[^/]+\/([a-z-]+)$/, '/lists/:id/$1'],
    [/^\/lists\/[^/]+$/, '/lists/:id'],
  ]
  for (const [re, out] of patterns) {
    const m = path.match(re)
    if (m) return out.replace('$1', m[1] ?? '')
  }
  const KNOWN = new Set([
    '/', '/levels', '/leaderboard', '/lists', '/builder', '/about', '/changelog',
    '/updates', '/community', '/account', '/inbox', '/admin', '/login', '/signup',
    '/locked', '/awaiting', '/void', '/records', '/opinions', '/open-verifications',
    '/clans',
  ])
  return KNOWN.has(path) ? path : '/other'
}

/**
 * Requests that aren't someone reading a page.
 *
 * Everything the browser fetches *because* of a page — the API calls, the
 * chunks, the images — would otherwise multiply one visit by twenty.
 */
export function isPageRequest(path: string, method: string): boolean {
  if (method !== 'GET') return false
  const clean = path.split('?')[0] ?? '/'
  if (clean.startsWith('/api/')) return false
  if (clean.startsWith('/_nuxt') || clean.startsWith('/__nuxt')) return false
  if (clean.startsWith('/_ipx')) return false
  // Anything with a file extension: favicons, fonts, source maps, robots.txt.
  if (/\.[a-z0-9]{1,8}$/i.test(clean)) return false
  return true
}

/**
 * Automated traffic, by its own admission.
 *
 * Only the agents that say what they are. Anything determined to look like a
 * browser will be counted as one, and that is the right place to stop: the
 * alternative is fingerprinting readers to catch crawlers.
 */
const BOT_RE = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|headlesschrome|python-requests|curl\/|wget|axios|go-http-client|node-fetch|monitoring|uptime|pingdom|semrush|ahrefs|dataprovider|scrapy/i
export function looksAutomated(userAgent: string): boolean {
  return !userAgent || BOT_RE.test(userAgent)
}

/** A prefetch is the browser guessing, not a person arriving. */
export function isPrefetch(purpose: string | undefined, secPurpose: string | undefined): boolean {
  const v = `${purpose ?? ''} ${secPurpose ?? ''}`.toLowerCase()
  return v.includes('prefetch') || v.includes('preview')
}

/**
 * Only a page that was actually delivered counts as read.
 *
 * A redirect isn't a page — the homepage answers 302 to `/levels/1`, so every
 * arrival at the site was being counted twice, once for the redirect and once
 * for the page it pointed at. A 404 isn't one either, and a 500 certainly
 * isn't. This is why the count happens when the response finishes rather than
 * when the request arrives: the status is the whole question.
 */
export function isDeliveredPage(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * How often the same reader may re-count the same page.
 *
 * `/api/analytics/view` has to be open — it is a beacon fired by a browser that
 * may be closing — and an open counter with no ceiling is not a statistic, it
 * is a suggestion. Fifty POSTs used to be fifty views. A person re-opening the
 * same page inside a quarter of a minute is a refresh, a double-click or a
 * script; past that it is a second reading and counts.
 *
 * In memory rather than in the database on purpose: it is a throttle, not a
 * record, and losing it on restart costs at most one extra view per reader.
 */
/**
 * Fifteen seconds was far too generous. It stopped a double-click and nothing
 * else: holding F5 at one page a second was throttled, and pressing it every
 * twenty seconds for an hour added a hundred and eighty views. Ten minutes is
 * the point at which re-opening a page is plausibly a second reading rather
 * than the same one, and it is keyed on the address (see `networkHash`) so
 * varying the user agent does not buy a fresh allowance.
 */
const REPEAT_WINDOW_MS = 10 * 60_000
/** Nobody reads two thousand pages a day. Past this, a "reader" is a program. */
const DAILY_VIEW_CAP = 2_000
const lastSeen = new Map<string, number>()
const perVisitorToday = new Map<string, { day: string; n: number }>()

/** Bounded, because this process is long-lived and the keys are unbounded. */
function remember(key: string, at: number): void {
  if (lastSeen.size > 20_000) {
    const cutoff = at - REPEAT_WINDOW_MS
    for (const [k, t] of lastSeen) if (t < cutoff) lastSeen.delete(k)
    // Still full: the traffic is real and the window is short, so start over
    // rather than grow. One over-count per reader is the worst case.
    if (lastSeen.size > 20_000) lastSeen.clear()
  }
  lastSeen.set(key, at)
}

/**
 * Whether this view is a new one, or the same one arriving again.
 *
 * Exported so the tests can drive it directly — the behaviour that matters is
 * "the same reader, the same page, twice in a second, counts once", and that is
 * not something you can see from the outside without waiting fifteen seconds.
 */
export function shouldCountView(visitor: string | null, path: string, at = Date.now()): boolean {
  if (!visitor) return true
  const day = today()
  const seen = perVisitorToday.get(visitor)
  const count = seen && seen.day === day ? seen.n : 0
  if (count >= DAILY_VIEW_CAP) return false

  const key = `${visitor}|${path}`
  const last = lastSeen.get(key)
  if (last != null && at - last < REPEAT_WINDOW_MS) return false

  remember(key, at)
  perVisitorToday.set(visitor, { day, n: count + 1 })
  return true
}

/** For tests, and for nothing else: the throttle is process-wide state. */
export function resetViewThrottle(): void {
  lastSeen.clear()
  perVisitorToday.clear()
}

/**
 * Record one page view.
 *
 * Three indexed upserts and no reads. Failures are swallowed: a counter is
 * never worth failing a page render over, and the one thing worse than missing
 * analytics is a site that goes down because of them.
 */
export function recordPageView(path: string, visitor: string | null, network: string | null = null): void {
  try {
    /**
     * Throttled on the *actual* path, stored against the shape.
     *
     * Those are different keys and it matters here more than anywhere: every
     * level shares one shape, so throttling on the shape would treat clicking
     * through twenty levels in a minute as one page opened twice. Reading down
     * the list is the main thing anyone does on this site.
     *
     * The throttle keys on the network rather than the visitor, so a script
     * varying its user agent can't mint a new allowance per request. `visitor`
     * is still what goes in the uniques table below — the two answer different
     * questions and must not be collapsed into one.
     */
    if (!shouldCountView(network ?? visitor, (path.split('?')[0] ?? '/'))) return
    const db = getDb()
    const { day, hour } = nowParts()
    const shape = normalisePath(path)

    /**
     * Three independent writes, each in its own try.
     *
     * They were one block, which meant a failure in any of them silently took
     * the ones after it with it — a missing hourly table stopped every visitor
     * being recorded, and the only symptom was a visitor count of zero beside a
     * healthy view count. These count different things and none of them is a
     * reason to give up on the others.
     */
    const write = (sql: string, ...params: unknown[]) => {
      try { db.prepare(sql).run(...params as never[]) } catch { /* one counter, not all of them */ }
    }
    write(
      `INSERT INTO page_views (day, path, views) VALUES (?, ?, 1)
       ON CONFLICT(day, path) DO UPDATE SET views = views + 1`, day, shape)
    write(
      `INSERT INTO page_views_hourly (day, hour, views) VALUES (?, ?, 1)
       ON CONFLICT(day, hour) DO UPDATE SET views = views + 1`, day, hour)
    if (visitor) {
      /**
       * The visitor row, and the hour they were seen in, folded into it.
       *
       * `hours` is a 24-bit mask and the update ORs the new bit in, so a reader
       * who comes back at seven and again at nine is one row carrying both. It
       * has to be OR rather than a read-then-write: two requests in the same
       * second would otherwise each read the old mask and the second would
       * write back a value missing the first one's bit.
       */
      write(
        `INSERT INTO visit_uniques (day, visitor, hours) VALUES (?, ?, ?)
         ON CONFLICT(day, visitor) DO UPDATE SET hours = hours | excluded.hours`,
        day, visitor, 1 << hour)
    }
  } catch { /* analytics must never break a page */ }
}

/**
 * Which accounts were here today, and which of them signed in.
 *
 * Memoised per process so an account that loads forty pages writes one row, not
 * forty. `login` forces the write through, because the row may already exist
 * from earlier browsing and the login still has to be counted.
 */
const touchedToday = new Set<string>()
export function touchAccountDay(accountId: number | null | undefined, login = false): void {
  if (!accountId) return
  try {
    const day = today()
    const key = `${day}|${accountId}`
    if (!login && touchedToday.has(key)) return
    if (touchedToday.size > 50_000) touchedToday.clear()
    touchedToday.add(key)
    getDb().prepare(
      `INSERT INTO account_days (day, account_id, logins) VALUES (?, ?, ?)
       ON CONFLICT(day, account_id) DO UPDATE SET logins = logins + ?`,
    ).run(day, accountId, login ? 1 : 0, login ? 1 : 0)
  } catch { /* as above */ }
}

/**
 * The reader behind a request, as the opaque daily hash.
 *
 * The three per-thing counters below need it for the same reason page views do
 * — so opening the same level fifty times in a loop is one view, not fifty —
 * and each of them was deriving it separately or not at all. One helper, so a
 * level, a profile and a list all count the same way.
 */
export function viewerOf(event: { node?: unknown }): string | null {
  try {
    const ip = getRequestIP(event as never, { xForwardedFor: true }) ?? ''
    // Deliberately the network hash, not the visitor hash. Everything this
    // value is used for is a throttle, and a throttle that a request header
    // can reset is not one — see `networkHash`.
    return networkHash(getDb(), ip, today())
  } catch {
    return null
  }
}

/** Record one view of one level, against its id rather than its position. */
export function recordLevelView(levelId: number, viewer: string | null = null): void {
  try {
    if (!shouldCountView(viewer, 'level:' + levelId)) return
    const db = getDb()
    db.prepare(
      `INSERT INTO level_views (level_id, views, last_viewed_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(level_id) DO UPDATE SET
         views = views + 1, last_viewed_at = datetime('now')`,
    ).run(levelId)
    try {
      db.prepare(
        `INSERT INTO level_view_days (day, level_id, views) VALUES (?, ?, 1)
         ON CONFLICT(day, level_id) DO UPDATE SET views = views + 1`,
      ).run(today(), levelId)
    } catch { /* the running total is the one that matters */ }
  } catch { /* as above */ }
}

/** The same for a profile. Against the account id, so a rename keeps the count. */
export function recordProfileView(accountId: number, viewer: string | null = null): void {
  try {
    if (!shouldCountView(viewer, 'profile:' + accountId)) return
    getDb().prepare(
      `INSERT INTO profile_views (account_id, views, last_viewed_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET
         views = views + 1, last_viewed_at = datetime('now')`,
    ).run(accountId)
  } catch { /* as above */ }
}

/** …and for a custom list, so its owner can see whether anyone read it. */
export function recordListView(listId: number, viewer: string | null = null): void {
  try {
    if (!shouldCountView(viewer, 'list:' + listId)) return
    const db = getDb()
    db.prepare(
      `INSERT INTO custom_list_views (list_id, views, last_viewed_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(list_id) DO UPDATE SET
         views = views + 1, last_viewed_at = datetime('now')`,
    ).run(listId)
    try {
      db.prepare(
        `INSERT INTO custom_list_view_days (day, list_id, views) VALUES (?, ?, 1)
         ON CONFLICT(day, list_id) DO UPDATE SET views = views + 1`,
      ).run(today(), listId)
    } catch { /* the running total is the one that matters */ }
  } catch { /* as above */ }
}

/**
 * Drop the per-day detail the counts no longer need.
 *
 * The running totals (`page_views`, `level_views`, `custom_list_views`) are the
 * history and stay forever. The tables pruned here are the ones with a row per
 * day per thing: they exist to answer "lately", and a year and a bit is enough
 * to compare a month with the same month last year.
 *
 * `visit_uniques` is the one with a row per *person* and so the one with a
 * reason to be forgotten rather than merely a size.
 */
const RETENTION_DAYS = 400
export function pruneAnalytics(): number {
  let removed = 0
  const cutoff = `-${RETENTION_DAYS} days`
  for (const table of ['visit_uniques', 'page_views_hourly', 'level_view_days', 'custom_list_view_days', 'account_days']) {
    try {
      removed += getDb().prepare(`DELETE FROM ${table} WHERE day < date('now', ?)`)
        .run(cutoff).changes as number
    } catch { /* a missing table on an old database is not worth failing over */ }
  }
  return removed
}

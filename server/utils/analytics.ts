import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '~/server/db'

/**
 * Counting how much the site is read, without keeping a record of who read it.
 *
 * Two numbers are worth having — how many pages were opened, and how many
 * people opened them — and everything here exists to produce those two and
 * nothing else. There is no per-request row, no address stored, no account
 * attached to a view. What is kept is a daily count per *shape* of URL, a daily
 * set of opaque visitor hashes, and a running total per level.
 */

/** Today, UTC, as `YYYY-MM-DD`. The whole table keys on this. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
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
 * Record one page view.
 *
 * Both writes are `INSERT … ON CONFLICT`, so this is two indexed upserts and
 * no reads. Failures are swallowed: a counter is never worth failing a page
 * render over, and the one thing worse than missing analytics is a site that
 * goes down because of them.
 */
export function recordPageView(path: string, visitor: string | null): void {
  try {
    const db = getDb()
    const day = today()
    db.prepare(
      `INSERT INTO page_views (day, path, views) VALUES (?, ?, 1)
       ON CONFLICT(day, path) DO UPDATE SET views = views + 1`,
    ).run(day, normalisePath(path))
    if (visitor) {
      db.prepare(
        `INSERT OR IGNORE INTO visit_uniques (day, visitor) VALUES (?, ?)`,
      ).run(day, visitor)
    }
  } catch { /* analytics must never break a page */ }
}

/** Record one view of one level, against its id rather than its position. */
export function recordLevelView(levelId: number): void {
  try {
    getDb().prepare(
      `INSERT INTO level_views (level_id, views, last_viewed_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(level_id) DO UPDATE SET
         views = views + 1, last_viewed_at = datetime('now')`,
    ).run(levelId)
  } catch { /* as above */ }
}

/** The same for a profile. Against the account id, so a rename keeps the count. */
export function recordProfileView(accountId: number): void {
  try {
    getDb().prepare(
      `INSERT INTO profile_views (account_id, views, last_viewed_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(account_id) DO UPDATE SET
         views = views + 1, last_viewed_at = datetime('now')`,
    ).run(accountId)
  } catch { /* as above */ }
}

/**
 * Drop the visitor hashes the counts no longer need.
 *
 * `page_views` and `level_views` are counts and stay; this table is the only
 * one with a row per person, so it is the only one with a reason to be
 * forgotten. A year and a bit is enough to compare a month with the same month
 * last year.
 */
const UNIQUE_RETENTION_DAYS = 400
export function pruneVisitUniques(): number {
  try {
    return getDb().prepare(
      `DELETE FROM visit_uniques WHERE day < date('now', ?)`,
    ).run(`-${UNIQUE_RETENTION_DAYS} days`).changes as number
  } catch {
    return 0
  }
}

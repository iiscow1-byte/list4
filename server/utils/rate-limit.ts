import type { H3Event } from 'h3'
import { createHash } from 'node:crypto'
import { getDb } from '~/server/db'
import { getCurrentAccount } from './auth'

/**
 * Rate limiting.
 *
 * ## Why this is in the database
 *
 * The obvious implementation is a `Map` in module scope, and it is wrong here
 * for two reasons. It is per process, so any deployment that runs more than one
 * loses the limit; and it is lost on restart, so "post 5 comments a minute"
 * becomes "post 5 comments per deploy" for anybody willing to wait for one. A
 * table survives both. The cost is one indexed upsert per limited request,
 * against a local SQLite file — cheaper than the work the request was about to
 * do anyway.
 *
 * ## Fixed windows, not a token bucket
 *
 * A fixed window can allow up to 2× the limit across a boundary: five at
 * 11:59:59 and five at 12:00:00. That is a known and acceptable weakness here —
 * these limits exist to stop floods and scripted abuse, not to meter an API,
 * and the alternative (a sliding log) means storing one row per event. Where
 * the burst matters, the window is short enough that 2× is still small.
 *
 * ## Subject: who is being limited
 *
 * Signed-in requests are limited per account; anonymous ones per address. An
 * account is the stronger identity — it survives an address change and cannot
 * be multiplied by a proxy — so it wins when both are available. Addresses are
 * hashed before storage: this table is not a log of who visited.
 */

export type RateLimitRule = {
  /** Names the limit. Two rules with one bucket share a budget. */
  bucket: string
  /** How many are allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSec: number
  /** Shown to the caller when they run out. */
  message?: string
}

/**
 * The limits the site actually applies, in one place.
 *
 * Collected here rather than written at each call site so they can be read
 * against each other — "is posting a comment really eight times stricter than
 * filing a report?" is a question you can only ask if they are side by side.
 */
export const LIMITS = {
  /**
   * Comments. The tightest limit on the site that ordinary use touches.
   *
   * Six a minute is far above conversational speed and far below what makes
   * spamming worthwhile; the hourly ceiling is what stops a slow drip.
   */
  commentBurst: { bucket: 'comment', limit: 6, windowSec: 60,
    message: 'You are commenting very quickly. Wait a moment.' },
  commentHourly: { bucket: 'comment:hour', limit: 60, windowSec: 3600,
    message: 'That is a lot of comments in an hour. Try again later.' },

  /** Forum posts are longer and slower by nature, so the burst is tighter. */
  forumPost: { bucket: 'forum', limit: 4, windowSec: 60,
    message: 'You are posting very quickly. Wait a moment.' },
  forumThread: { bucket: 'forum:thread', limit: 6, windowSec: 3600,
    message: 'You have started a lot of threads recently.' },

  /**
   * Reports. Deliberately generous per hour — somebody working through a
   * genuinely bad actor's history files several — and capped per day, because
   * past that it is harassment by queue.
   */
  report: { bucket: 'report', limit: 10, windowSec: 3600,
    message: 'You have filed a lot of reports. Give the moderators a moment.' },

  /**
   * Sign-up, per address. The single most abused endpoint on any site.
   */
  signup: { bucket: 'signup', limit: 3, windowSec: 3600,
    message: 'Too many accounts created from here. Try again later.' },

  /**
   * Failed sign-ins, per address *and* separately per account.
   *
   * Per address stops one machine working through a password list. Per account
   * stops a distributed attempt at one person — the case address limiting
   * cannot see. Only failures count: rate-limiting successful logins would lock
   * out a shared connection for no security benefit.
   */
  loginIp: { bucket: 'login:ip', limit: 15, windowSec: 900,
    message: 'Too many failed sign-ins. Wait fifteen minutes.' },
  loginAccount: { bucket: 'login:acct', limit: 8, windowSec: 900,
    message: 'Too many failed sign-ins for that account. Wait fifteen minutes.' },

  /** Anything that sends an email, which costs money and reputation. */
  email: { bucket: 'email', limit: 5, windowSec: 3600,
    message: 'Too many emails requested. Try again in an hour.' },

  /** Record and level submissions — moderated, but the queue is finite. */
  submission: { bucket: 'submit', limit: 20, windowSec: 3600,
    message: 'You have submitted a lot recently. Try again later.' },

  /** Friend requests, which arrive in somebody else's inbox. */
  friendRequest: { bucket: 'friend', limit: 20, windowSec: 3600,
    message: 'Too many friend requests. Try again later.' },
} as const satisfies Record<string, RateLimitRule>

/** Hashed, so this table never holds an address. */
function hashSubject(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

/**
 * Who this request is, for limiting purposes.
 *
 * Prefers the account. Falls back to the address, hashed. Returns a stable
 * string either way, so a caller never has to think about which it got.
 */
export function rateSubject(event: H3Event): string {
  try {
    const account = getCurrentAccount(event)
    if (account) return `a:${account.id}`
  } catch { /* fall through to the address */ }
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  return `i:${hashSubject(ip)}`
}

/** The address alone, for limits that must not be resettable by signing out. */
export function ipSubject(event: H3Event): string {
  return `i:${hashSubject(getRequestIP(event, { xForwardedFor: true }) ?? 'unknown')}`
}

/** Occasionally drop windows nobody can be inside any more. */
let lastSweep = 0
function sweep(db: ReturnType<typeof getDb>, now: number): void {
  if (now - lastSweep < 300_000) return
  lastSweep = now
  try {
    // A day covers every window defined above with room to spare.
    db.prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
      .run(Math.floor(now / 1000) - 86_400)
  } catch { /* housekeeping is never worth failing a request over */ }
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number }

/**
 * Count one hit against a rule and say whether it is allowed.
 *
 * **Fails open.** If the database cannot be read the request proceeds: a
 * limiter that takes the site down when it breaks has converted a spam problem
 * into an outage. Every caller here is also protected by something else —
 * authentication, moderation, or a unique index — so open is the right failure
 * direction.
 */
export function hitRateLimit(rule: RateLimitRule, subject: string): RateLimitResult {
  const now = Date.now()
  const windowStart = Math.floor(now / 1000 / rule.windowSec) * rule.windowSec
  try {
    const db = getDb()
    sweep(db, now)

    // Upsert-then-read in one statement: two statements would let two
    // concurrent requests both read the old count and both be allowed.
    const row = db.prepare(
      `INSERT INTO rate_limits (bucket, subject, window_start, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(bucket, subject, window_start)
         DO UPDATE SET count = count + 1
       RETURNING count`,
    ).get(rule.bucket, subject, windowStart) as { count: number } | undefined

    const count = row?.count ?? 1
    const resetAt = (windowStart + rule.windowSec) * 1000
    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    }
  } catch {
    return { allowed: true, remaining: rule.limit, retryAfterSec: 0 }
  }
}

/**
 * Apply a rule, throwing 429 when it is exceeded.
 *
 * Sets `Retry-After`, which is the difference between a limit a well-behaved
 * client can respect and one it can only discover by failing.
 */
export function enforceRateLimit(event: H3Event, rule: RateLimitRule, subject?: string): void {
  const result = hitRateLimit(rule, subject ?? rateSubject(event))
  if (result.allowed) return
  setResponseHeader(event, 'Retry-After', String(result.retryAfterSec))
  throw createError({
    statusCode: 429,
    statusMessage: rule.message ?? 'Too many requests. Try again shortly.',
  })
}

/**
 * Check a rule without counting against it.
 *
 * For flows where the expensive thing may not happen — a sign-in that might
 * succeed, say. Counting a hit that never occurred means an honest user who
 * mistypes once is charged twice.
 */
export function peekRateLimit(rule: RateLimitRule, subject: string): boolean {
  const windowStart = Math.floor(Date.now() / 1000 / rule.windowSec) * rule.windowSec
  try {
    const row = getDb().prepare(
      `SELECT count FROM rate_limits WHERE bucket = ? AND subject = ? AND window_start = ?`,
    ).get(rule.bucket, subject, windowStart) as { count: number } | undefined
    return (row?.count ?? 0) < rule.limit
  } catch {
    return true
  }
}

/** Forget a subject's hits for a rule — used when a sign-in finally succeeds. */
export function clearRateLimit(rule: RateLimitRule, subject: string): void {
  try {
    getDb().prepare(`DELETE FROM rate_limits WHERE bucket = ? AND subject = ?`)
      .run(rule.bucket, subject)
  } catch { /* non-fatal */ }
}

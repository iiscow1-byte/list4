import { getDb } from '~/server/db'
import { verifyPassword, createSession, setSessionCookie } from '~/server/utils/auth'
import { touchAccountDay } from '~/server/utils/analytics'
import { clearRateLimit, hitRateLimit, ipSubject, LIMITS } from '~/server/utils/rate-limit'
import { captchaEnabled, tokenFromBody, verifyCaptcha } from '~/server/utils/captcha'

/** Failures from one address before a captcha is demanded on every attempt. */
const CAPTCHA_AFTER_FAILURES = 3

/**
 * Sign in.
 *
 * ## Rate limiting, in two directions
 *
 * By **address**, which stops one machine working through a password list. And
 * by **account**, which stops a distributed attempt at one person — many
 * addresses trying one username is invisible to an address limit, and it is the
 * shape a targeted attack actually takes.
 *
 * Only failures count. Charging successful sign-ins would lock out everyone
 * behind a shared connection — a school, an office, a phone network — for no
 * security benefit whatsoever. A success also *clears* that account's failure
 * budget, so somebody who mistypes twice and then gets it right is not left
 * three failures from being locked out of their own account.
 *
 * The limits are checked before the password is verified, so a locked-out
 * caller does not get the (deliberately slow) hash computed for them: otherwise
 * the endpoint remains a way to make the server burn CPU on demand.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')

  const ip = ipSubject(event)
  const accountSubject = `u:${username.toLowerCase()}`

  // Read the counters without touching them: incrementing here would charge
  // every attempt including the successful ones, which is what the note above
  // rules out.
  if (!isWithinLimit(LIMITS.loginIp, ip) || !isWithinLimit(LIMITS.loginAccount, accountSubject)) {
    setResponseHeader(event, 'Retry-After', String(LIMITS.loginIp.windowSec))
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many failed sign-ins. Wait a few minutes and try again.',
    })
  }

  /**
   * A captcha, but only once this address has been getting it wrong.
   *
   * Demanding one on every sign-in would put a third-party round trip in front
   * of the most-used form on the site, for everyone, forever — to stop a thing
   * that only matters in bulk. After three failures from one address the
   * calculus flips: somebody guessing has to solve one per attempt, and
   * somebody who simply mistyped their password twice is unaffected.
   *
   * The count is the same rate-limit row the lockout uses, so a successful
   * sign-in clears the captcha requirement along with the failure budget.
   */
  const needsCaptcha = captchaEnabled() && failureCount(LIMITS.loginIp, ip) >= CAPTCHA_AFTER_FAILURES
  if (needsCaptcha) {
    const ok = await verifyCaptcha(tokenFromBody(body), getRequestIP(event, { xForwardedFor: true }))
    if (!ok) {
      // `data` rather than only a message: the form needs to *render* a widget,
      // which is a different response from "wrong password".
      throw createError({
        statusCode: 400,
        statusMessage: 'Complete the captcha to continue.',
        data: { captchaRequired: true },
      })
    }
  }

  const db = getDb()
  const row = db.prepare(
    `SELECT id, username, password_hash, password_salt, role, banned_at, banned_reason
       FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as any

  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    // Charged only now, and identically whether the account exists or the
    // password was wrong — the two must not be distinguishable, by message or
    // by which counter moved.
    hitRateLimit(LIMITS.loginIp, ip)
    hitRateLimit(LIMITS.loginAccount, accountSubject)
    throw createError({ statusCode: 401, statusMessage: 'Invalid username or password.' })
  }

  if (row.banned_at) {
    throw createError({
      statusCode: 403,
      statusMessage: row.banned_reason
        ? `Account banned: ${row.banned_reason}`
        : 'Account banned.',
    })
  }

  clearRateLimit(LIMITS.loginAccount, accountSubject)

  const token = createSession(row.id)
  setSessionCookie(event, token)
  // The one place an actual sign-in happens. Sessions carry no `created_at`, so
  // without this the site could say who was *here* on a day and never how many
  // of them had signed in on it.
  touchAccountDay(row.id, true)
  return { username: row.username, role: row.role }
})

/** How many failures are on the clock for this subject, in the current window. */
function failureCount(rule: { bucket: string; windowSec: number }, subject: string): number {
  const windowStart = Math.floor(Date.now() / 1000 / rule.windowSec) * rule.windowSec
  try {
    const row = getDb().prepare(
      `SELECT count FROM rate_limits WHERE bucket = ? AND subject = ? AND window_start = ?`,
    ).get(rule.bucket, subject, windowStart) as { count: number } | undefined
    return row?.count ?? 0
  } catch {
    // Fails open, like the rest of the limiter — see server/utils/rate-limit.ts.
    return 0
  }
}

/** Read a counter without incrementing it. */
function isWithinLimit(rule: { bucket: string; limit: number; windowSec: number }, subject: string): boolean {
  return failureCount(rule, subject) < rule.limit
}

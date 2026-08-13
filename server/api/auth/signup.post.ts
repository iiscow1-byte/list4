import { LOCKDOWN_HEADLINE } from '~/utils/lockdown'
import { getDb } from '~/server/db'
import { hashPassword, createSession, setSessionCookie } from '~/server/utils/auth'
import { SIGNUPS_ENABLED } from '~/server/utils/site-access'
import { assertClean } from '~/server/utils/profanity-guard'
import { touchAccountDay } from '~/server/utils/analytics'
import { enforceRateLimit, ipSubject, LIMITS } from '~/server/utils/rate-limit'
import { looksLikeEmail, mailEnabled, normaliseEmail } from '~/server/utils/mail'
import { sendVerificationEmail } from '~/server/utils/email-verify'
import { logActivity } from '~/server/utils/activity-log'
import { assertCaptcha, captchaEnabled } from '~/server/utils/captcha'

const BOOTSTRAP_ADMIN = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'Gerg').toLowerCase()

export default defineEventHandler(async (event) => {
  // Closed here, not just hidden in the UI — the form is one `curl` away.
  // Admin accounts are created with `npm run make-admin` while this is off.
  if (!SIGNUPS_ENABLED) {
    throw createError({
      statusCode: 403,
      statusMessage: `Account creation is closed. ${LOCKDOWN_HEADLINE}`,
    })
  }

  /**
   * Limited by address, before anything else happens.
   *
   * Keyed on the address rather than `rateSubject`, because an account is
   * exactly what this endpoint hands out — subject-based limiting would let
   * each new account reset the budget for creating the next one.
   */
  enforceRateLimit(event, LIMITS.signup, ipSubject(event))

  const body = await readBody(event)

  /**
   * Captcha, before anything is written or hashed.
   *
   * Three layers guard this endpoint and they stop different things. The rate
   * limit caps one address; the captcha raises the per-attempt cost so a
   * botnet spread across many addresses is not free either; and the email
   * confirmation below means an account that gets past both still cannot post
   * until somebody reads an inbox. None of them is sufficient alone — this one
   * least of all, since solver farms exist — and that is why there are three.
   *
   * Skipped entirely when no provider is configured. See `captchaEnabled`.
   */
  await assertCaptcha(body, getRequestIP(event, { xForwardedFor: true }))
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')
  const rawEmail = String(body?.email ?? '').trim()

  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
    throw createError({ statusCode: 400, statusMessage: 'Username must be 3–32 characters: letters, numbers, underscore, or hyphen.' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters.' })
  }
  /**
   * A ceiling as well as a floor.
   *
   * The hash is scrypt, whose cost is a function of input length — an unbounded
   * password field is a way to make the server do unbounded work per request,
   * which is a denial of service dressed as a strong password.
   */
  if (password.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at most 200 characters.' })
  }
  // A username isn't a message — it appears beside every record its owner holds,
  // in the leaderboard and in other people's inboxes, with no way to opt out.
  assertClean(username, 'Usernames')

  /**
   * The address is required only when the site can actually send to it.
   *
   * On a deployment with no mail provider configured, demanding one would
   * collect addresses nobody can verify and block sign-up on a check that can
   * never pass. See `mailEnabled`.
   */
  const wantsEmail = mailEnabled()
  let email: string | null = null
  if (rawEmail) {
    if (!looksLikeEmail(rawEmail)) {
      throw createError({ statusCode: 400, statusMessage: 'That does not look like an email address.' })
    }
    email = normaliseEmail(rawEmail)
  } else if (wantsEmail) {
    throw createError({ statusCode: 400, statusMessage: 'An email address is required.' })
  }

  const db = getDb()
  const existing = db.prepare(`SELECT id FROM accounts WHERE username = ? COLLATE NOCASE`).get(username)
  if (existing) throw createError({ statusCode: 409, statusMessage: 'Username already taken.' })

  /**
   * A *verified* address may only belong to one account.
   *
   * Unverified ones are deliberately not checked: an unproved address is a
   * claim, and refusing a sign-up because somebody else typed that address
   * first would let anyone deny an address to its real owner. Whoever proves it
   * gets it — `markVerified` clears the losing claims.
   */
  if (email) {
    const taken = db.prepare(
      `SELECT id FROM accounts WHERE email = ? COLLATE NOCASE AND email_verified_at IS NOT NULL`,
    ).get(email)
    if (taken) {
      throw createError({ statusCode: 409, statusMessage: 'That email address is already in use.' })
    }
  }

  const { hash, salt } = hashPassword(password)
  const role = username.toLowerCase() === BOOTSTRAP_ADMIN ? 'admin' : 'user'
  const result = db.prepare(
    `INSERT INTO accounts (username, password_hash, password_salt, role, email) VALUES (?, ?, ?, ?, ?)`,
  ).run(username, hash, salt, role, email)
  const accountId = Number(result.lastInsertRowid)

  let emailSent = false
  if (email) {
    emailSent = await sendVerificationEmail(db, { id: accountId, username }, email)
  }

  logActivity({
    kind: 'account.create',
    area: 'accounts',
    severity: 'info',
    subject: { kind: 'account', id: accountId, label: username },
    summary: `Created an account`,
    detail: { has_email: !!email, verification_sent: emailSent },
  }, db)

  const token = createSession(accountId)
  setSessionCookie(event, token)
  // Signing up ends with a session, so it is a sign-in on the day it happened.
  touchAccountDay(accountId, true)

  return {
    username,
    role,
    /** Whether they need to go and click something before they can post. */
    needsVerification: wantsEmail,
    verificationSent: emailSent,
  }
})

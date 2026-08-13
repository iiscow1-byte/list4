import { getDb } from '~/server/db'
import { claimToken, markVerified } from '~/server/utils/email-verify'
import { enforceRateLimit, ipSubject, LIMITS } from '~/server/utils/rate-limit'

/**
 * Spend a verification link.
 *
 * Deliberately does **not** require a session. The person clicking the link in
 * their inbox is frequently not the person with the cookie — a different
 * browser, a phone, a link forwarded to themselves — and requiring a sign-in
 * first turns a one-click confirmation into a login wall. Possession of the
 * token is the proof; that is what the token is for.
 *
 * Rate limited by address anyway, because an endpoint that takes a secret and
 * says whether it was right is a guessing oracle if you can call it fast enough
 * — even one where guessing 32 random bytes is hopeless.
 */
export default defineEventHandler(async (event) => {
  enforceRateLimit(event, LIMITS.email, ipSubject(event))

  const body = await readBody<{ token?: unknown }>(event) ?? {}
  const token = typeof body.token === 'string' ? body.token : ''
  if (!token) throw createError({ statusCode: 400, statusMessage: 'No token.' })

  const db = getDb()
  const claimed = claimToken(db, 'verify', token)
  if (!claimed) {
    // One message for expired, used and never-existed. Distinguishing them
    // tells a caller which of their guesses was closest to real.
    throw createError({
      statusCode: 400,
      statusMessage: 'That link has expired or has already been used. Ask for a new one from your account page.',
    })
  }

  markVerified(db, claimed.account_id, claimed.email)

  const account = db.prepare(`SELECT username FROM accounts WHERE id = ?`)
    .get(claimed.account_id) as { username: string } | undefined

  return { ok: true, username: account?.username ?? null, email: claimed.email }
})

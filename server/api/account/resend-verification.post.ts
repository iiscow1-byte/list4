import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'
import { looksLikeEmail, mailEnabled, normaliseEmail } from '~/server/utils/mail'
import { sendVerificationEmail } from '~/server/utils/email-verify'

/**
 * Send the confirmation link again, optionally to a corrected address.
 *
 * The correction matters more than the resend: the commonest reason a
 * verification email never arrives is a typo in the address, and without a way
 * to fix it the account is stranded — it cannot verify, and the address it
 * cannot verify is the one blocking a second sign-up.
 *
 * A changed address is written to `email` only while unverified. Once an
 * account *has* a proved address, a new one goes to `pending_email` and the old
 * one keeps working until the new one is proved — otherwise anybody who got
 * hold of a session could swap the address and lock the owner out of their own
 * recovery.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  enforceRateLimit(event, LIMITS.email)

  if (!mailEnabled()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'This site is not set up to send email yet.',
    })
  }

  const body = await readBody<{ email?: unknown }>(event) ?? {}
  const db = getDb()
  const row = db.prepare(
    `SELECT email, pending_email, email_verified_at FROM accounts WHERE id = ?`,
  ).get(me.id) as { email: string | null; pending_email: string | null; email_verified_at: string | null } | undefined

  let target = row?.pending_email || row?.email || null

  if (typeof body.email === 'string' && body.email.trim()) {
    const next = normaliseEmail(body.email)
    if (!looksLikeEmail(next)) {
      throw createError({ statusCode: 400, statusMessage: 'That does not look like an email address.' })
    }
    const taken = db.prepare(
      `SELECT id FROM accounts
        WHERE email = ? COLLATE NOCASE AND email_verified_at IS NOT NULL AND id <> ?`,
    ).get(next, me.id)
    if (taken) {
      throw createError({ statusCode: 409, statusMessage: 'That email address is already in use.' })
    }

    if (row?.email_verified_at) {
      // Already proved one: the new address is pending until proved too.
      db.prepare(`UPDATE accounts SET pending_email = ? WHERE id = ?`).run(next, me.id)
    } else {
      db.prepare(`UPDATE accounts SET email = ? WHERE id = ?`).run(next, me.id)
    }
    target = next
  }

  if (!target) {
    throw createError({ statusCode: 400, statusMessage: 'Add an email address first.' })
  }

  const sent = await sendVerificationEmail(db, { id: me.id, username: me.username }, target)
  if (!sent) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not send that just now. Try again in a few minutes.',
    })
  }

  // Echoed back so the page can say where it went — a resend that does not say
  // which address it used is exactly as useless as the one that never arrived.
  return { ok: true, email: target }
})

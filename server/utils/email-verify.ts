import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '~/server/db'
import { sendMail, siteOrigin, mailEnabled } from './mail'
import { logActivity } from './activity-log'

/**
 * Proving you can read an inbox.
 *
 * ## Tokens are stored hashed
 *
 * The row holds `sha256(token)`, never the token. A token in this table would
 * be a working link: anybody with a copy of the database — a backup, a leaked
 * dump — could verify or reset any account. Hashing means the only place a
 * usable token ever exists is the email itself. This is the same argument as
 * `password_hash`, and it applies for the same reason.
 *
 * Lookup is by hash, so it is still one indexed query — this costs nothing.
 *
 * ## They expire and they are single-use
 *
 * `used_at` is set inside the same statement that claims the token
 * (`UPDATE … WHERE used_at IS NULL`), so two concurrent clicks cannot both
 * succeed. A token that has been used is as dead as one that has expired.
 */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const RESET_TTL_MS = 60 * 60 * 1000

export type TokenKind = 'verify' | 'reset'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Mint a token, store its hash, return the token.
 *
 * Any earlier unused token of the same kind for the same account is killed
 * first. Otherwise "resend" leaves a trail of working links, each of which is a
 * standing way into the account for anybody who ever saw one.
 */
export function issueToken(
  db: DatabaseSync,
  accountId: number,
  kind: TokenKind,
  email: string,
): string {
  db.prepare(
    `UPDATE email_tokens SET used_at = datetime('now')
      WHERE account_id = ? AND kind = ? AND used_at IS NULL`,
  ).run(accountId, kind)

  // 32 bytes of CSPRNG, base64url. Long enough that guessing is not a strategy.
  const token = randomBytes(32).toString('base64url')
  const ttl = kind === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS
  db.prepare(
    `INSERT INTO email_tokens (account_id, kind, token_hash, email, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(accountId, kind, hashToken(token), email, new Date(Date.now() + ttl).toISOString())

  return token
}

export type ClaimedToken = { account_id: number; email: string }

/**
 * Spend a token, or refuse.
 *
 * The claim is a conditional UPDATE rather than a SELECT followed by an UPDATE.
 * Two clicks on the same link — which happens routinely, because mail clients
 * prefetch — would otherwise both pass the check and both act.
 */
export function claimToken(db: DatabaseSync, kind: TokenKind, token: string): ClaimedToken | null {
  if (!token || token.length > 512) return null
  const row = db.prepare(
    `UPDATE email_tokens
        SET used_at = datetime('now')
      WHERE token_hash = ?
        AND kind = ?
        AND used_at IS NULL
        AND expires_at > datetime('now')
      RETURNING account_id, email`,
  ).get(hashToken(token), kind) as ClaimedToken | undefined
  return row ?? null
}

/**
 * Constant-time compare, for the places a token is checked against a known
 * value rather than looked up. Exported because getting this wrong quietly is
 * the classic way a token check becomes a guessing oracle.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Send somebody the link that proves their address.
 *
 * Returns whether it was actually sent. Callers must not claim "check your
 * inbox" when this is false — see `mailEnabled`.
 */
export async function sendVerificationEmail(
  db: DatabaseSync,
  account: { id: number; username: string },
  email: string,
): Promise<boolean> {
  const origin = siteOrigin()
  if (!origin || !mailEnabled()) {
    // Still issue the token: an admin can hand the link over, and the log
    // records that verification was attempted.
    issueToken(db, account.id, 'verify', email)
    return false
  }

  const token = issueToken(db, account.id, 'verify', email)
  const link = `${origin}/verify-email?token=${encodeURIComponent(token)}`

  return sendMail({
    to: email,
    subject: 'Confirm your email — All Levels List',
    text: [
      `Hi ${account.username},`,
      '',
      'Confirm this address to finish setting up your All Levels List account:',
      '',
      link,
      '',
      'The link works once and expires in 24 hours.',
      '',
      "If you didn't create an account, ignore this — nothing will happen, and",
      'the address will not be used again.',
    ].join('\n'),
  })
}

/**
 * Mark an account's address as proved.
 *
 * Clears the *same address* from any other account that had it unverified.
 * Without that, a second account holding the claim would collide with the
 * partial unique index the moment its owner tried to verify — and the person
 * who actually owns the inbox should win, which is exactly who this is.
 */
export function markVerified(db: DatabaseSync, accountId: number, email: string): void {
  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE accounts
          SET email = NULL, pending_email = NULL
        WHERE id <> ? AND email = ? COLLATE NOCASE AND email_verified_at IS NULL`,
    ).run(accountId, email)

    db.prepare(
      `UPDATE accounts
          SET email = ?, pending_email = NULL, email_verified_at = datetime('now')
        WHERE id = ?`,
    ).run(email, accountId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  logActivity({
    kind: 'account.email.verified',
    area: 'accounts',
    severity: 'info',
    subject: { kind: 'account', id: accountId },
    summary: 'Confirmed their email address',
  }, db)
}

/**
 * Whether this account has proved an address.
 *
 * Used to gate the things spam is actually made of. Deliberately *not* used to
 * gate signing in or reading the site: an account that cannot receive its
 * verification email — because the site has no mail provider, or the message
 * bounced — must still be able to get in and ask for help.
 */
export function isVerified(account: { email_verified_at?: string | null } | null): boolean {
  return !!account?.email_verified_at
}

/**
 * Does this account need to prove an address before posting?
 *
 * False when the site cannot send email at all, which is what keeps an
 * unconfigured deployment usable. Also false for staff, who are created by an
 * administrator rather than by signing up.
 */
export function requiresVerification(account: {
  email_verified_at?: string | null
  role?: string
  discord_id?: string | null
} | null): boolean {
  if (!account) return false
  if (!mailEnabled()) return false
  if (account.role && account.role !== 'user') return false
  /**
   * A Discord sign-in is already proof.
   *
   * The gate exists so that posting costs more than a POST request — an
   * account should cost somebody an inbox. Signing in through Discord costs
   * more than that: the account had to already be in the community's server,
   * which is revocable in a way an email address is not. Asking those accounts
   * to also confirm an address they were never asked for would lock them out
   * of the site entirely, since they have none to confirm.
   */
  if (account.discord_id) return false
  return !account.email_verified_at
}

/** Throw the standard 403 for an action that needs a proved address. */
export function assertVerified(account: {
  email_verified_at?: string | null
  role?: string
  discord_id?: string | null
} | null): void {
  if (!requiresVerification(account)) return
  throw createError({
    statusCode: 403,
    statusMessage: 'Confirm your email address first — check your inbox, or resend from your account page.',
  })
}

/** Housekeeping: drop tokens nobody can use. */
export function purgeExpiredTokens(db: DatabaseSync = getDb()): void {
  try {
    db.prepare(
      `DELETE FROM email_tokens
        WHERE expires_at < datetime('now', '-7 days')
           OR (used_at IS NOT NULL AND used_at < datetime('now', '-7 days'))`,
    ).run()
  } catch { /* non-fatal */ }
}

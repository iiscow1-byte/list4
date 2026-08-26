import { getDb } from '~/server/db'
import { createSession, setSessionCookie, getCurrentAccount } from '~/server/utils/auth'
import { enforceRateLimit, ipSubject, LIMITS } from '~/server/utils/rate-limit'
import { touchAccountDay } from '~/server/utils/analytics'
import { logActivity } from '~/server/utils/activity-log'
import { signupsEnabled } from '~/server/utils/site-access'
import {
  discordConfig, consumeState, statesMatch, exchangeCode, fetchDiscordUser,
  checkGuildMembership, usernameFromDiscord, safeReturnTo,
} from '~/server/utils/discord-oauth'

/**
 * Where Discord sends the browser back.
 *
 * Ends in a redirect either way, never JSON: this URL is opened by a person's
 * browser, so a failure has to land them on a page that explains itself. The
 * reason travels as `?discord_error=` for the login page to render.
 *
 * Three outcomes, in order of precedence:
 *   already linked  — sign that account in
 *   signed in       — attach this Discord identity to the current account
 *   neither         — create an account
 *
 * All three are gated on membership of the configured server, which is checked
 * before anything is written.
 */
function fail(event: any, code: string, returnTo = '/login') {
  /**
   * Land somewhere that renders the reason.
   *
   * `/login` and `/signup` both know how to turn `?discord_error=` into a
   * sentence; nothing else does. A failure sent anywhere else — the homepage,
   * a level page — would be silent, which is how "not in the server" ended up
   * looking like the button was broken.
   */
  const target = returnTo === '/login' || returnTo === '/signup' ? returnTo : '/login'
  return sendRedirect(event, `${target}?discord_error=${encodeURIComponent(code)}`, 302)
}

/** Auth pages are where a journey starts, so success never returns to one. */
function landing(returnTo: string, fallback = '/') {
  return returnTo === '/login' || returnTo === '/signup' ? fallback : returnTo
}

export default defineEventHandler(async (event) => {
  const cfg = discordConfig()
  if (!cfg) throw createError({ statusCode: 503, statusMessage: 'Discord sign-in is not configured.' })

  enforceRateLimit(event, LIMITS.discordOauth, ipSubject(event))

  const query = getQuery(event)
  const { state: cookieState, returnTo: rawReturn } = consumeState(event)
  const returnTo = safeReturnTo(rawReturn)

  // The user pressed Cancel on Discord's consent screen.
  if (query.error) return fail(event, 'cancelled', returnTo)

  const code = String(query.code ?? '')
  const urlState = String(query.state ?? '')
  if (!code) return fail(event, 'no_code', returnTo)
  // The state cookie is the only thing tying this callback to a sign-in this
  // browser actually started.
  if (!statesMatch(cookieState, urlState)) return fail(event, 'bad_state', returnTo)

  let token: string
  let profile: Awaited<ReturnType<typeof fetchDiscordUser>>
  let guild: Awaited<ReturnType<typeof checkGuildMembership>>
  try {
    token = await exchangeCode(cfg, code)
    profile = await fetchDiscordUser(token)
    guild = await checkGuildMembership(cfg, token)
  } catch {
    return fail(event, 'discord_unavailable', returnTo)
  }

  // The gate. Nothing is created or linked for somebody outside the server.
  if (!guild.member) return fail(event, 'not_in_server', returnTo)
  if (!guild.hasRole) return fail(event, 'missing_role', returnTo)

  const db = getDb()
  const now = new Date().toISOString()
  const displayName = profile.global_name || profile.username

  const existing = db.prepare(
    `SELECT id, username, banned_at FROM accounts WHERE discord_id = ?`,
  ).get(profile.id) as { id: number; username: string; banned_at: string | null } | undefined

  if (existing) {
    if (existing.banned_at) return fail(event, 'banned', returnTo)
    db.prepare(
      `UPDATE accounts SET discord_username = ?, discord_guild_checked_at = ? WHERE id = ?`,
    ).run(displayName, now, existing.id)
    setSessionCookie(event, createSession(existing.id))
    touchAccountDay(existing.id)
    return sendRedirect(event, landing(returnTo), 302)
  }

  // Signed in already: this is "link my Discord", not "sign me in".
  const current = getCurrentAccount(event)
  if (current) {
    const taken = db.prepare(
      `SELECT 1 AS n FROM accounts WHERE discord_id = ? AND id <> ?`,
    ).get(profile.id, current.id)
    if (taken) return fail(event, 'discord_taken', returnTo)
    db.prepare(
      `UPDATE accounts SET discord_id = ?, discord_username = ?, discord_guild_checked_at = ? WHERE id = ?`,
    ).run(profile.id, displayName, now, current.id)
    logActivity({
      kind: 'account.discord_link',
      area: 'accounts',
      severity: 'info',
      actor: { id: current.id, username: current.username, role: current.role },
      subject: { kind: 'account', id: current.id, label: current.username },
      summary: 'Linked a Discord account',
      detail: { discord_username: displayName },
    })
    return sendRedirect(event, landing(returnTo, '/account'), 302)
  }

  /**
   * A new account.
   *
   * The site-wide signup lock applies here too. Being in the server is a
   * stronger gate than an email address, but it is still a way to create an
   * account, and "account creation is closed" has to mean closed — otherwise
   * the lockdown has a door in it that the settings page never mentions.
   * Existing Discord accounts sign in normally throughout.
   *
   * No password is set — this identity is the credential, and a random
   * unusable hash is stored so the password columns stay NOT NULL and no
   * password can ever match. Signing in again goes back through Discord.
   */
  if (!signupsEnabled()) return fail(event, 'signups_closed', returnTo)

  let username = usernameFromDiscord(profile)
  const isTaken = db.prepare(`SELECT 1 AS n FROM accounts WHERE username = ? COLLATE NOCASE`)
  if (isTaken.get(username)) {
    let n = 2
    while (n < 500 && isTaken.get(`${username}${n}`.slice(0, 32))) n++
    username = `${username}${n}`.slice(0, 32)
  }

  const { randomBytes } = await import('node:crypto')
  const unusable = randomBytes(32).toString('hex')

  const info = db.prepare(`
    INSERT INTO accounts (username, password_hash, password_salt, discord_id, discord_username,
                          discord_guild_checked_at, discord_handle)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, unusable, unusable, profile.id, displayName, now, displayName)

  const accountId = Number(info.lastInsertRowid)
  setSessionCookie(event, createSession(accountId))
  touchAccountDay(accountId)
  logActivity({
    kind: 'account.create',
    area: 'accounts',
    severity: 'info',
    subject: { kind: 'account', id: accountId, label: username },
    summary: 'Created an account with Discord',
    detail: { discord_username: displayName },
  })
  return sendRedirect(event, landing(returnTo), 302)
})

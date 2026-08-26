import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * Signing in with Discord, gated on membership of one server.
 *
 * The point is spam control rather than convenience. An email address costs a
 * throwaway inbox; a Discord account that is already in the community's server
 * costs an invite, a join, and whatever the server's own gate asks for — and it
 * is revocable, because being removed from the server takes the login with it
 * on the next check.
 *
 * Scopes are the two narrowest that can answer the question:
 *   identify              — the account's id, name and avatar. No email.
 *   guilds.members.read   — membership of ONE named guild, asked for by id.
 *
 * `guilds.members.read` is deliberate over the broader `guilds`: that one hands
 * over the full list of every server the person is in, which is none of this
 * site's business, and it pages badly for anyone in more than 200. Asking about
 * the single guild is one request and reveals nothing else.
 */

const API = 'https://discord.com/api/v10'
export const DISCORD_STATE_COOKIE = 'als_discord_state'
export const DISCORD_RETURN_COOKIE = 'als_discord_return'

export type DiscordConfig = {
  clientId: string
  clientSecret: string
  guildId: string
  /** Optional: membership alone isn't enough, this role is also required. */
  roleId: string | null
  redirectUri: string
  /** Shown to somebody who isn't in the server, so they know where to go. */
  inviteUrl: string | null
}

/**
 * Configuration, or null when Discord login is switched off.
 *
 * Every piece is required together — a half-configured OAuth app is worse than
 * none, because the button appears and the flow dead-ends on Discord's own
 * error page with no explanation this site can add.
 */
export function discordConfig(): DiscordConfig | null {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim()
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim()
  const guildId = process.env.DISCORD_GUILD_ID?.trim()
  const siteUrl = process.env.SITE_URL?.trim()?.replace(/\/+$/, '')
  if (!clientId || !clientSecret || !guildId || !siteUrl) return null
  return {
    clientId,
    clientSecret,
    guildId,
    roleId: process.env.DISCORD_REQUIRED_ROLE_ID?.trim() || null,
    redirectUri: `${siteUrl}/api/auth/discord/callback`,
    inviteUrl: process.env.DISCORD_INVITE_URL?.trim() || null,
  }
}

export function discordEnabled(): boolean {
  return discordConfig() !== null
}

/**
 * A CSRF token for the round trip.
 *
 * Without it, a third party can send somebody's browser to our callback with a
 * code they obtained themselves and end up with our session cookie attached to
 * their Discord account. The value goes out in the URL and into an httpOnly
 * cookie; the callback only proceeds when the two match.
 */
export function issueState(event: H3Event, returnTo: string): string {
  const state = randomBytes(24).toString('hex')
  const opts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 10 * 60,
    secure: process.env.NODE_ENV === 'production',
  }
  setCookie(event, DISCORD_STATE_COOKIE, state, opts)
  // Only ever a path on this site — see `safeReturnTo`.
  setCookie(event, DISCORD_RETURN_COOKIE, returnTo, opts)
  return state
}

export function consumeState(event: H3Event): { state: string | null; returnTo: string } {
  const state = getCookie(event, DISCORD_STATE_COOKIE) ?? null
  const returnTo = getCookie(event, DISCORD_RETURN_COOKIE) ?? '/'
  deleteCookie(event, DISCORD_STATE_COOKIE, { path: '/' })
  deleteCookie(event, DISCORD_RETURN_COOKIE, { path: '/' })
  return { state, returnTo }
}

/** Constant-time compare, so the state cookie can't be probed a byte at a time. */
export function statesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/**
 * Somewhere on this site, and nowhere else.
 *
 * The return path survives the trip to Discord in a cookie, which makes it
 * attacker-influencable in exactly the way an open redirect needs. Only a
 * single-slash-rooted path is allowed: `//evil.com` and `https://evil.com` are
 * both absolute despite looking relative.
 */
export function safeReturnTo(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s.startsWith('/') || s.startsWith('//')) return '/'
  if (s.includes('\\')) return '/'
  return s
}

export function authorizeUrl(cfg: DiscordConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state,
    // Always show the consent screen: silently reusing a previous grant makes
    // "sign in as someone else" impossible on a shared machine.
    prompt: 'consent',
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

export type DiscordUser = { id: string; username: string; global_name: string | null; avatar: string | null }

/** Trade the one-time code for a token. The secret never leaves the server. */
export async function exchangeCode(cfg: DiscordConfig, code: string): Promise<string> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
    }),
  })
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: 'Discord rejected the sign-in. Try again.' })
  const json = await res.json() as { access_token?: string }
  if (!json.access_token) throw createError({ statusCode: 502, statusMessage: 'Discord returned no token.' })
  return json.access_token
}

export async function fetchDiscordUser(token: string): Promise<DiscordUser> {
  const res = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: 'Could not read your Discord account.' })
  return await res.json() as DiscordUser
}

export type GuildCheck = { member: boolean; hasRole: boolean }

/**
 * Membership of the required server, and optionally a role in it.
 *
 * 404 is the ordinary "not a member" answer rather than a failure. Anything
 * else — 401, 429, a 500 from Discord — is left to throw, because treating an
 * outage as "not a member" would lock out the whole community, and treating it
 * as "member" would open the gate this exists to close.
 */
export async function checkGuildMembership(cfg: DiscordConfig, token: string): Promise<GuildCheck> {
  const res = await fetch(`${API}/users/@me/guilds/${cfg.guildId}/member`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return { member: false, hasRole: false }
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: 'Could not check your Discord server membership. Try again.' })
  }
  const member = await res.json() as { roles?: string[] }
  const roles = Array.isArray(member.roles) ? member.roles : []
  return { member: true, hasRole: cfg.roleId ? roles.includes(cfg.roleId) : true }
}

/**
 * A site username derived from a Discord one.
 *
 * The site's own rule is 3–32 of `[A-Za-z0-9_-]`, and Discord names routinely
 * contain none of that — dots, spaces, emoji, non-Latin scripts. Strip to what
 * is allowed, pad if it collapsed to nothing, and let the caller de-duplicate.
 */
export function usernameFromDiscord(u: DiscordUser): string {
  const base = (u.global_name || u.username || '').normalize('NFKD')
  const cleaned = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return cleaned.length >= 3 ? cleaned : `gd${u.id.slice(-8)}`
}

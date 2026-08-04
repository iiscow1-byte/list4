import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { getDb } from '~/server/db'
// Lives in its own module so standalone scripts can import it without pulling
// in the `~/server/db` alias. Re-exported below so callers don't have to care.
import { hashPassword, verifyPassword } from './password'

export { hashPassword, verifyPassword }

export const SESSION_COOKIE = 'als_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type Role = 'user' | 'moderator' | 'admin' | 'owner' | 'developer'

// Roles that have admin-level permissions. Owner and developer behave exactly
// like admin server-side; the distinction is only how the role badge renders.
const ADMIN_ROLES = new Set<Role>(['admin', 'owner', 'developer'])

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.has(role)
}

export function isModRole(role: Role): boolean {
  return role === 'moderator' || ADMIN_ROLES.has(role)
}

export type Account = {
  id: number
  username: string
  role: Role
  bio: string | null
  country: string | null
  subdivision: string | null
  claimed_player: string | null
  claimed_aredl_uuid: string | null
  claimed_pointercrate_id: number | null
  claimed_gdl_id: number | null
  has_avatar: boolean
  pronouns: string | null
  discord_handle: string | null
  youtube_url: string | null
  gd_username: string | null
  favorite_level_id: number | null
  favorite_level_note: string | null
  /** The record a player pins to their profile as their hardest completion. */
  hardest_record_id: number | null
  /** Which pick paints the profile header. */
  banner_choice: 'hardest' | 'favorite' | 'level' | 'none' | 'custom'
  /** Free-choice header level, used when `banner_choice` is 'level'. */
  banner_level_id: number | null
  /** Staff-only decorations — a cover image, and an emoji / badge by the name. */
  banner_image_url: string | null
  name_emoji: string | null
  name_badge: string | null
  name_badge_color: string | null
}

export function createSession(accountId: number): string {
  const db = getDb()
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare(`INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, accountId, expiresAt)
  return token
}

export function destroySession(token: string) {
  getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
}

export function setSessionCookie(event: H3Event, token: string) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === 'production',
  })
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export function getCurrentAccount(event: H3Event): Account | null {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null
  const db = getDb()
  const row = db.prepare(
    `SELECT a.id, a.username, a.role, a.bio, a.country, a.subdivision, a.claimed_player,
            a.claimed_aredl_uuid, a.claimed_pointercrate_id, a.claimed_gdl_id,
            (a.avatar_blob IS NOT NULL) AS has_avatar, a.banned_at, s.expires_at,
            a.pronouns, a.discord_handle, a.youtube_url, a.gd_username,
            a.favorite_level_id, a.favorite_level_note,
            a.hardest_record_id, a.banner_choice, a.banner_level_id,
            a.banner_image_url, a.name_emoji, a.name_badge, a.name_badge_color
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
      WHERE s.token = ?`,
  ).get(token) as any
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
    return null
  }
  // Banned: drop the session so the cookie stops resolving and the user is
  // effectively signed out across the site without them having to refresh.
  if (row.banned_at) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
    return null
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    bio: row.bio,
    country: row.country,
    subdivision: row.subdivision,
    claimed_player: row.claimed_player,
    claimed_aredl_uuid: row.claimed_aredl_uuid,
    claimed_pointercrate_id: row.claimed_pointercrate_id ?? null,
    claimed_gdl_id: row.claimed_gdl_id ?? null,
    has_avatar: !!row.has_avatar,
    pronouns: row.pronouns,
    discord_handle: row.discord_handle,
    youtube_url: row.youtube_url,
    favorite_level_id: row.favorite_level_id ?? null,
    favorite_level_note: row.favorite_level_note ?? null,
    // These were queried but never returned, so every caller saw `undefined`:
    // the account settings form re-defaulted the banner and the pinned
    // completion each time it opened, and a PATCH that omitted them fell back
    // to `undefined ?? null` and cleared them.
    //
    // `gd_username` was the one still missing, and it was worse than a reset:
    // `undefined` cannot be bound to a SQLite parameter, so any PATCH that
    // didn't send it returned a 500. The settings form always sends every
    // field, which is the only reason nobody hit it.
    gd_username: row.gd_username ?? null,
    hardest_record_id: row.hardest_record_id ?? null,
    banner_choice: row.banner_choice ?? 'hardest',
    banner_level_id: row.banner_level_id ?? null,
    banner_image_url: row.banner_image_url ?? null,
    name_emoji: row.name_emoji ?? null,
    name_badge: row.name_badge ?? null,
    name_badge_color: row.name_badge_color ?? null,
  }
}

export function requireAccount(event: H3Event): Account {
  const a = getCurrentAccount(event)
  if (!a) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  return a
}

export function requireAdmin(event: H3Event): Account {
  const a = requireAccount(event)
  if (!isAdminRole(a.role)) throw createError({ statusCode: 403, statusMessage: 'Admin only' })
  return a
}

export function requireMod(event: H3Event): Account {
  const a = requireAccount(event)
  if (!isModRole(a.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Moderators or admins only' })
  }
  return a
}

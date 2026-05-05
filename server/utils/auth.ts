import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getDb } from '~/server/db'

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
  has_avatar: boolean
  pronouns: string | null
  discord_handle: string | null
  youtube_url: string | null
  favorite_level_id: number | null
  favorite_level_note: string | null
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const test = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (test.length !== expected.length) return false
  return timingSafeEqual(test, expected)
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
            a.claimed_aredl_uuid,
            (a.avatar_blob IS NOT NULL) AS has_avatar, a.banned_at, s.expires_at,
            a.pronouns, a.discord_handle, a.youtube_url,
            a.favorite_level_id, a.favorite_level_note
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
    has_avatar: !!row.has_avatar,
    pronouns: row.pronouns,
    discord_handle: row.discord_handle,
    youtube_url: row.youtube_url,
    favorite_level_id: row.favorite_level_id ?? null,
    favorite_level_note: row.favorite_level_note ?? null,
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

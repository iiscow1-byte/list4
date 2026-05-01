import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getDb } from '~/server/db'

export const SESSION_COOKIE = 'als_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type Role = 'user' | 'moderator' | 'admin'

export type Account = {
  id: number
  username: string
  role: Role
  bio: string | null
  country: string | null
  subdivision: string | null
  claimed_player: string | null
  has_avatar: boolean
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
            (a.avatar_blob IS NOT NULL) AS has_avatar, a.banned_at, s.expires_at
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
    has_avatar: !!row.has_avatar,
  }
}

export function requireAccount(event: H3Event): Account {
  const a = getCurrentAccount(event)
  if (!a) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  return a
}

export function requireAdmin(event: H3Event): Account {
  const a = requireAccount(event)
  if (a.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Admin only' })
  return a
}

export function requireMod(event: H3Event): Account {
  const a = requireAccount(event)
  if (a.role !== 'admin' && a.role !== 'moderator') {
    throw createError({ statusCode: 403, statusMessage: 'Moderators or admins only' })
  }
  return a
}

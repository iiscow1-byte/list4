import type { Account } from './auth'
import { getDb } from '~/server/db'

/**
 * Who can use the site, and whether anyone can join.
 *
 * Both switches live here rather than being scattered through handlers, so
 * "is the site open" has exactly one answer and re-opening is a config change
 * rather than a code change. Both default to the closed position: a deployment
 * that forgets to set anything is locked, which is the safe direction to fail.
 */

/**
 * Whether anyone can register, as a setting rather than a constant.
 *
 * This was `process.env.ALLOW_SIGNUPS === '1'`, read once at module load, so
 * opening or closing registration meant editing the environment and restarting
 * — which on a hosted deploy is a redeploy, and is not something to be doing at
 * the moment a wave of spam accounts arrives. It is a row in `site_settings`
 * now, flipped from the admin panel and effective on the next request.
 *
 * The environment variable is still the *initial* value: a fresh database takes
 * `ALLOW_SIGNUPS` for its first answer, so existing deployments come up exactly
 * as they were configured. After that the stored value wins.
 */
export function signupsEnabled(): boolean {
  const row = getDb().prepare(
    `SELECT value FROM site_settings WHERE key = 'signups_enabled'`,
  ).get() as { value: string } | undefined
  if (row) return row.value === '1'
  return process.env.ALLOW_SIGNUPS === '1'
}

export function setSignupsEnabled(on: boolean): void {
  getDb().prepare(`
    INSERT INTO site_settings (key, value, updated_at) VALUES ('signups_enabled', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(on ? '1' : '0')
}

/**
 * Whether the site is closed to everyone but staff.
 *
 * Runtime, for the same reason registration is: shutting the doors is something
 * you want to do at the moment it becomes necessary, and an environment
 * variable means a redeploy to get there and another to come back. Stored under
 * `admin_only`; `PUBLIC_SITE` still decides the answer until it is first set,
 * so an existing deployment comes up exactly as configured.
 *
 * Both directions default closed if nothing is set anywhere, which is the safe
 * way to fail for a switch about who may read the site at all.
 */
export function adminOnly(): boolean {
  const row = getDb().prepare(
    `SELECT value FROM site_settings WHERE key = 'admin_only'`,
  ).get() as { value: string } | undefined
  if (row) return row.value === '1'
  return process.env.PUBLIC_SITE !== '1'
}

export function setAdminOnly(on: boolean): void {
  getDb().prepare(`
    INSERT INTO site_settings (key, value, updated_at) VALUES ('admin_only', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(on ? '1' : '0')
}

/**
 * Roles that may use the site while it is locked down.
 *
 * Deliberately the same set `requireAdmin` uses, so "admin" means one thing
 * across the codebase. Moderators are *not* included by default — they are a
 * review role, not an owner role — but `LOCKDOWN_ALLOW_MODERATORS=1` adds them
 * without a redeploy of anything else.
 */
export const STAFF_ROLES: ReadonlySet<string> = new Set(
  process.env.LOCKDOWN_ALLOW_MODERATORS === '1'
    ? ['admin', 'owner', 'developer', 'moderator']
    : ['admin', 'owner', 'developer'],
)

export function isStaff(account: Pick<Account, 'role'> | null | undefined): boolean {
  return !!account && STAFF_ROLES.has(account.role)
}

/**
 * Paths that stay reachable while locked down.
 *
 * This list is the difference between "locked" and "bricked": without the auth
 * endpoints and the client bundle, an admin has no way to sign in and unlock
 * anything. Kept as narrow as that requirement allows.
 */
const ALLOWED_EXACT = new Set([
  // The platform's health check. Never gated: a closed site that answers the
  // health check with a redirect gets restarted for being closed.
  '/api/site/health',
  '/login',
  '/locked',
  '/favicon.ico',
  '/robots.txt',
  '/api/auth/login',
  '/api/auth/logout',
  // Rendered on every page including /login, and read by the client to decide
  // whether it is looking at a staff session at all.
  '/api/auth/me',
])

const ALLOWED_PREFIXES = [
  '/_nuxt/',      // client bundle + build manifest
  '/__nuxt',      // dev/error internals
  '/_ipx/',       // image transforms, if ever enabled
]

/**
 * Nuxt fetches `/some/route/_payload.json` when navigating client-side. The
 * payload has to be gated by the route it belongs to, not waved through — so
 * strip the suffix and judge the underlying path.
 */
export function normalisePath(pathname: string): string {
  if (pathname.endsWith('/_payload.json')) {
    const base = pathname.slice(0, -'/_payload.json'.length)
    return base === '' ? '/' : base
  }
  return pathname
}

export function isPublicPath(pathname: string): boolean {
  const p = normalisePath(pathname)
  if (ALLOWED_EXACT.has(p)) return true
  return ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix))
}

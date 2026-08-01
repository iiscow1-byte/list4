import type { Account } from './auth'

/**
 * Who can use the site, and whether anyone can join.
 *
 * Both switches live here rather than being scattered through handlers, so
 * "is the site open" has exactly one answer and re-opening is a config change
 * rather than a code change. Both default to the closed position: a deployment
 * that forgets to set anything is locked, which is the safe direction to fail.
 */

/** `ALLOW_SIGNUPS=1` re-opens registration. */
export const SIGNUPS_ENABLED = process.env.ALLOW_SIGNUPS === '1'

/** `PUBLIC_SITE=1` re-opens the site to everyone. */
export const ADMIN_ONLY = process.env.PUBLIC_SITE !== '1'

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

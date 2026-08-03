import { LOCKDOWN_NOTICE } from '~/utils/lockdown'
import { timingSafeEqual } from 'node:crypto'
import { getCurrentAccount } from '~/server/utils/auth'
import { ADMIN_ONLY, isPublicPath, isStaff, normalisePath } from '~/server/utils/site-access'
import { INTERNAL_HEADER, INTERNAL_TOKEN } from '~/server/utils/internal-token'

/** Constant-time compare, so the token can't be probed a byte at a time. */
function isInternalCall(header: string | undefined): boolean {
  if (!header || header.length !== INTERNAL_TOKEN.length) return false
  return timingSafeEqual(Buffer.from(header), Buffer.from(INTERNAL_TOKEN))
}

/**
 * Closes the whole site to everyone but staff.
 *
 * Server-side on purpose. A route middleware only guards navigation in the
 * browser: without this, every `/api/**` endpoint still answers to anyone who
 * types the URL, and the entire list, every profile and the whole leaderboard
 * are one `curl` away. The client middleware alongside this one exists for the
 * navigation experience, not for access control.
 *
 * Numbered `00.` so it runs before any other server middleware.
 */
export default defineEventHandler((event) => {
  if (!ADMIN_ONLY) return

  const path = normalisePath(event.path.split('?')[0] ?? '/')
  if (isPublicPath(path)) return

  // This server calling its own API while rendering a page. Server-side
  // `$fetch` carries no cookies, so without this every server-rendered page
  // fails for the staff it is supposed to serve. The page request that
  // triggered it was already checked here on the way in.
  if (isInternalCall(getHeader(event, INTERNAL_HEADER))) return

  const account = getCurrentAccount(event)
  if (isStaff(account)) return

  const isApi = path.startsWith('/api/')
  if (isApi) {
    throw createError({
      statusCode: 403,
      statusMessage: LOCKDOWN_NOTICE,
    })
  }

  // A signed-in non-staff user has nothing to gain from the login form — send
  // them somewhere that explains the situation instead of looping them through
  // a form they can already satisfy.
  if (account) return sendRedirect(event, '/locked', 302)

  const next = encodeURIComponent(event.path)
  return sendRedirect(event, `/login?next=${next}`, 302)
})

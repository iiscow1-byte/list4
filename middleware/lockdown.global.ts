/**
 * Route middleware: keeps non-staff out of client-side navigation while the
 * site is locked down.
 *
 * This is the navigation half only. Access control proper lives in
 * `server/middleware/00.lockdown.ts` — a route middleware cannot stop anyone
 * from calling the API directly, so it is not what keeps the site closed. What
 * it does do is keep a soft navigation from rendering a page the server would
 * have refused, which otherwise shows a flash of content before the next
 * request bounces.
 *
 * The verdict comes from the server (`site.canAccess`) rather than being
 * re-derived from the role here, so the two halves cannot disagree.
 */
const ALWAYS_ALLOWED = new Set(['/login', '/locked'])

export default defineNuxtRouteMiddleware(async (to) => {
  if (ALWAYS_ALLOWED.has(to.path)) return

  const { data } = await useCurrentUser()
  const res = data.value
  // No policy yet (first paint, or the fetch failed) — let the server decide
  // rather than guessing and bouncing someone who is allowed in.
  if (!res?.site?.adminOnly) return
  if (res.site.canAccess) return

  if (res.account) return navigateTo('/locked')
  return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
})

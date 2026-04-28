/**
 * Route middleware: only allows moderators or admins. The /admin panel uses
 * this so mods can review record submissions even though they can't approve
 * claims or change roles (those tabs are hidden client-side and the underlying
 * APIs reject mods server-side).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { data } = await useCurrentUser()
  const acc = data.value?.account
  if (!acc) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }
  if (acc.role !== 'admin' && acc.role !== 'moderator') {
    return abortNavigation({ statusCode: 403, statusMessage: 'Mods or admins only' })
  }
})

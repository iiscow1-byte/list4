/**
 * Route middleware: only allows admins. Apply with
 * `definePageMeta({ middleware: 'admin' })`.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { data } = await useCurrentUser()
  const acc = data.value?.account
  if (!acc) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }
  if (acc.role !== 'admin' && acc.role !== 'owner' && acc.role !== 'developer') {
    return abortNavigation({ statusCode: 403, statusMessage: 'Admin only' })
  }
})

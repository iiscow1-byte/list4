/**
 * Route middleware: redirects unauthenticated users to /login. Apply with
 * `definePageMeta({ middleware: 'auth' })`.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { data } = await useCurrentUser()
  if (!data.value?.account) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }
})

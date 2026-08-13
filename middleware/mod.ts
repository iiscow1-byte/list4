/**
 * Route middleware for the admin panel.
 *
 * Allows anyone with a job inside it: list helpers, moderators and admins. It
 * is deliberately the *widest* gate on the panel and not the only one — what
 * each of them can actually see is decided by `tabs` in `pages/admin.vue`, and
 * what they can actually do is decided per endpoint on the server. This check
 * only answers "is there anything in here for you at all".
 *
 * A list helper's answer is yes, but barely: three queues out of fifteen tabs.
 * They place levels and review level and record submissions, so they need
 * somewhere to do it, and that somewhere is this panel with almost all of it
 * absent. Nothing here grants them anything — the server rejects a helper on
 * every other endpoint whatever the client renders.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { data } = await useCurrentUser()
  const acc = data.value?.account
  if (!acc) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }
  if (acc.role === 'user') {
    return abortNavigation({ statusCode: 403, statusMessage: 'List staff only' })
  }
})

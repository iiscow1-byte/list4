/**
 * Reports pages opened by moving around the site.
 *
 * The server middleware counts document requests, which is the first page of a
 * visit and nothing after it: Nuxt renders every subsequent page in the
 * browser without asking the server for one. Reading the middleware's numbers
 * alone would report the first page of each visit as the whole visit.
 *
 * So: skip the navigation that *is* the document load — it has already been
 * counted — and report each one after it. Sent with `keepalive` so a click
 * straight out of the site still records the page it was on, and dropped
 * entirely if it fails, because a counter is not worth a console error on a
 * page that otherwise works.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  let firstDone = false

  router.afterEach((to, from) => {
    // The initial render. `from` is Vue Router's synthetic start route, which
    // is the tell that nothing has actually been navigated *from*.
    if (!firstDone) {
      firstDone = true
      if (!from.name) return
    }
    // The *path*, not the full path. `?tab=stats` on the About page, `?view=mine`
    // on the lists gallery and every admin tab write a new query with
    // `router.replace`, which fires this hook — so flicking through the admin
    // panel's fifteen tabs used to score fifteen views of `/admin`.
    if (to.path === from.path) return

    try {
      const body = JSON.stringify({ path: to.path })
      // `sendBeacon` where it exists: it survives the page being closed, which
      // is exactly when the last navigation of a visit happens.
      if (navigator.sendBeacon?.(
        '/api/analytics/view', new Blob([body], { type: 'application/json' }),
      )) return
      fetch('/api/analytics/view', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {})
    } catch { /* never worth breaking a navigation over */ }
  })

  // Referenced so the plugin's shape matches the rest of the app's.
  void nuxtApp
})

<script setup lang="ts">
/**
 * The list is the homepage. The list itself lives at /levels/:position — a
 * full-viewport 3-panel layout — so `/` hands off to the top of the list
 * rather than duplicating that page. A `q` on the URL is forwarded so a
 * shared search link like /?q=tidal still lands on the right search.
 *
 * ## Why this is middleware and not `await navigateTo(...)` in setup
 *
 * It used to be the latter, and that is what made the site appear to freeze:
 * the address bar would change while the page under it stayed put.
 *
 * A page with a top-level `await` is an async component, so Nuxt suspends the
 * *current* navigation until its setup resolves. Calling `navigateTo` inside
 * that setup and awaiting it asks the router to start a second navigation
 * before the first one has finished — the redirect can't complete until setup
 * returns, and setup can't return until the redirect completes. The router has
 * already written the new URL by then, so the symptom is a changed link over an
 * unchanged page, and it only showed up when moving *through* `/` — which is
 * exactly what clicking the header logo between menus does.
 *
 * Route middleware runs before any component is created, so returning a
 * redirect from here is resolved by the router as part of the same navigation
 * and there is no second one to deadlock against.
 */
definePageMeta({
  middleware(to) {
    const q = typeof to.query.q === 'string' ? to.query.q : undefined
    return navigateTo(
      { path: '/levels/1', query: q ? { q } : {} },
      { replace: true },
    )
  },
})
</script>

<template>
  <!-- Only ever seen if the redirect above is somehow skipped. -->
  <div class="container-wide py-16 text-center text-sm text-zinc-500">
    Opening the list…
  </div>
</template>

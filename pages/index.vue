<script setup lang="ts">
/**
 * The list is the homepage. The list itself lives at /levels/:position — a
 * full-viewport 3-panel layout — so `/` hands off to the top of the list
 * rather than duplicating that page. A `q` on the URL is forwarded so a
 * shared search link like /?q=tidal still lands on the right search.
 */
const route = useRoute()
const q = typeof route.query.q === 'string' ? route.query.q : undefined

await navigateTo({ path: '/levels/1', query: q ? { q } : {}, replace: true })
</script>

<template>
  <div class="container-wide py-16 text-center text-sm text-zinc-500">
    Opening the list…
  </div>
</template>

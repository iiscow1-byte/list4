<script setup lang="ts">
type Match = {
  kind: 'level' | 'awaiting' | 'open_verification' | 'void'
  path: string
  name: string
  placement: number | null
}

/**
 * `alllevelslist.com/<gd id>` — a permanent link to a level.
 *
 * A level's URL is its *placement*, and placements move: every link anyone has
 * ever shared to a level on this list points at whatever is sitting at that
 * number today, which after a month of movements is a different level. The GD
 * ID doesn't move, so this is the form of link that keeps working.
 *
 * ## The catch-all, and why it is safe
 *
 * This is a root-level dynamic route, so it matches any single-segment path
 * that nothing else claims. Static routes win over dynamic ones in the router,
 * so `/about`, `/login` and the rest are untouched; what reaches here is the
 * set of one-segment URLs that would previously have 404'd. Anything that is
 * not all digits still 404s, from the middleware, before this component is
 * created.
 *
 * ## Why the redirect is middleware
 *
 * The same reason `pages/index.vue` gives at length: `await navigateTo(...)`
 * inside the setup of a page that also has a top-level `await` deadlocks
 * against the navigation it is part of, and shows up as the URL changing while
 * the page underneath it doesn't. Middleware runs before any component exists,
 * so the redirect resolves as part of the same navigation.
 *
 * ## Duplicates
 *
 * `levels.gd_id` is not unique — see the endpoint. With one match this page is
 * never seen; with several it is the disambiguation, because guessing which of
 * them the sharer meant is the one behaviour that makes a permalink worse than
 * no permalink.
 */
definePageMeta({
  async middleware(to) {
    const id = String(to.params.permalink ?? '')
    // Not a level ID at all — this is just an unknown URL.
    if (!/^\d{1,12}$/.test(id)) {
      throw createError({ statusCode: 404, statusMessage: 'Page not found.' })
    }

    const res = await $fetch<{ matches: Match[] }>(`/api/levels/permalink/${id}`)
      .catch(() => null)

    const matches = res?.matches ?? []
    if (matches.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: `No level with ID ${id} is on this site.`,
      })
    }
    // `replace`, so Back returns to wherever the link was followed from rather
    // than to a URL that immediately bounces forward again.
    if (matches.length === 1) return navigateTo(matches[0]!.path, { replace: true })
    // Several: fall through and ask.
  },
})

const route = useRoute()
const gdId = computed(() => String(route.params.permalink ?? ''))

const { data } = await useFetch<{ gd_id: number; matches: Match[] }>(
  () => `/api/levels/permalink/${gdId.value}`,
)

const KIND_LABEL: Record<Match['kind'], string> = {
  level: 'On the list',
  awaiting: 'Awaiting placement',
  open_verification: 'Open verification',
  void: 'Void list',
}

useHead(() => ({ title: `Level ${gdId.value} — All Levels List` }))
</script>

<template>
  <div class="container-tight max-w-lg py-12 sm:py-16">
    <h1 class="text-xl font-semibold tracking-tight">More than one level has this ID</h1>
    <p class="text-sm text-zinc-400 mt-2 leading-relaxed">
      Level ID <span class="tabular-nums text-zinc-200">{{ gdId }}</span> matches
      {{ data?.matches?.length ?? 0 }} entries on this site. Pick the one you meant.
    </p>

    <ul class="mt-5 space-y-1.5">
      <li v-for="m in data?.matches ?? []" :key="`${m.kind}:${m.path}`">
        <NuxtLink
          :to="m.path"
          class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 hover:border-accent/50 transition-colors group"
        >
          <span
            v-if="m.placement != null"
            class="shrink-0 tabular-nums text-sm font-semibold text-accent"
          >#{{ m.placement }}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-zinc-200 truncate group-hover:text-accent transition-colors">{{ m.name }}</span>
            <span class="block text-[11px] text-zinc-600">{{ KIND_LABEL[m.kind] }}</span>
          </span>
          <span class="shrink-0 text-zinc-700 group-hover:text-accent transition-colors" aria-hidden="true">›</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

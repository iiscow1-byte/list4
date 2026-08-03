<script setup lang="ts">
import { gdLevelUrl } from '~/utils/gd-links'
import { difficultyColor, ratingColor } from '~/utils/stat-colors'

/**
 * Search Geometry Dash itself and act on a result: submit the level to the
 * list, or submit a record for it. Removes the "go find the level ID
 * somewhere else first" step from both submission flows.
 */
type Result = {
  gd_id: number
  name: string
  author: string | null
  description: string | null
  difficulty: string | null
  rating: string
  stars: number | null
  downloads: number | null
  likes: number | null
  length: string | null
  song: string | null
  on_list: { position: number; sheet_placement: number | null; name: string } | null
}

const route = useRoute()
const router = useRouter()
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const results = ref<Result[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searched = ref(false)

let ctrl: AbortController | null = null
async function run() {
  const q = search.value.trim()
  router.replace({ query: q ? { q } : {} })
  if (!q) { results.value = []; searched.value = false; return }
  loading.value = true
  error.value = null
  ctrl?.abort()
  const mine = new AbortController()
  ctrl = mine
  try {
    const res = await $fetch<{ results: Result[] }>('/api/gd/search', {
      query: { q }, signal: mine.signal,
    })
    if (ctrl !== mine) return
    results.value = res.results
    searched.value = true
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.cause?.name === 'AbortError') return
    error.value = e?.data?.statusMessage ?? 'Search failed. Try again in a moment.'
    results.value = []
  } finally {
    if (ctrl === mine) { loading.value = false; ctrl = null }
  }
}

// Run immediately when arriving with ?q= already set (e.g. a shared link).
if (search.value.trim()) await run()

function fmt(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

useHead({ title: 'Find a level — All Levels List' })
</script>

<template>
  <div class="container-tight py-8 space-y-5">
    <header class="space-y-2">
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Find a level</h1>
      <p class="text-sm text-zinc-500">
        Search Geometry Dash directly, then submit the level to the list or submit a record for it —
        no need to track down the level ID first.
      </p>
    </header>

    <form class="flex items-stretch gap-2" @submit.prevent="run">
      <input
        v-model="search"
        type="search"
        placeholder="Level name or ID…"
        autofocus
        class="flex-1 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <button
        type="submit"
        :disabled="loading || !search.trim()"
        class="shrink-0 rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
      >{{ loading ? 'Searching…' : 'Search' }}</button>
    </form>

    <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
    <p v-else-if="searched && !loading && results.length === 0" class="text-sm text-zinc-500 py-8 text-center">
      No levels matched “{{ search }}”.
    </p>

    <ul v-if="results.length" class="space-y-2">
      <li
        v-for="r in results"
        :key="r.gd_id"
        class="relative overflow-hidden rounded-xl border border-zinc-800/80 group"
      >
        <LevelThumbBg
          :gd-id="r.gd_id"
          res="medium"
          img-class="opacity-25 group-hover:opacity-40"
          overlay-class="bg-gradient-to-r from-zinc-950/94 via-zinc-950/80 to-zinc-950/45"
        />
        <div class="relative p-3 sm:p-4 flex flex-wrap items-start gap-x-4 gap-y-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="font-semibold text-zinc-50 truncate">{{ r.name }}</h2>
              <span
                v-if="r.difficulty"
                class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                :style="{ backgroundColor: difficultyColor(r.difficulty), color: '#0a0a0a' }"
              >{{ r.difficulty }}</span>
              <span
                class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                :style="{ backgroundColor: ratingColor(r.rating), color: '#0a0a0a' }"
              >{{ r.rating }}</span>
            </div>
            <p class="text-xs text-zinc-400 mt-0.5">
              by {{ r.author ?? 'Unknown' }}
              <span class="text-zinc-600">· ID {{ r.gd_id }}</span>
              <span v-if="r.length" class="text-zinc-600">· {{ r.length }}</span>
            </p>
            <p v-if="r.description" class="text-xs text-zinc-500 mt-1 line-clamp-2">{{ r.description }}</p>
            <p class="text-[11px] text-zinc-600 mt-1 tabular-nums">
              {{ fmt(r.downloads) }} downloads · {{ fmt(r.likes) }} likes
              <span v-if="r.song"> · {{ r.song }}</span>
            </p>
          </div>

          <div class="flex flex-col items-stretch gap-1.5 shrink-0 w-full sm:w-auto">
            <template v-if="r.on_list">
              <NuxtLink
                :to="`/levels/${r.on_list.position}`"
                class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 text-center hover:bg-accent/90 transition-colors"
              >On the list · #{{ r.on_list.sheet_placement ?? r.on_list.position }}</NuxtLink>
              <NuxtLink
                :to="`/records/submit?position=${r.on_list.position}`"
                class="rounded-lg border border-zinc-700 text-zinc-300 text-xs px-3 py-1.5 text-center hover:border-zinc-500 hover:text-zinc-100 transition-colors"
              >Submit a record</NuxtLink>
            </template>
            <template v-else>
              <NuxtLink
                :to="`/levels/submit?gd_id=${r.gd_id}&name=${encodeURIComponent(r.name)}`"
                class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 text-center hover:bg-accent/90 transition-colors"
              >Submit to the list</NuxtLink>
              <span class="text-[10px] text-zinc-600 text-center">Not ranked yet</span>
            </template>
            <a
              :href="gdLevelUrl(r.gd_id)!"
              target="_blank"
              rel="noopener"
              class="text-[10px] text-zinc-600 hover:text-accent text-center transition-colors"
            >View on GDBrowser ↗</a>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

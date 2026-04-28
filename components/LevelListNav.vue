<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type LevelRow = { position: number; name: string; difficulty: string | null; points: number | null; gddl_tier: string | null }

const props = defineProps<{ activePosition?: number | null }>()

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 500
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const items = ref<LevelRow[]>([])
const total = ref(0)
const nextPage = ref(1)
const loading = ref(false)
const initialLoaded = ref(false)
const done = computed(() => items.value.length >= total.value && initialLoaded.value)

async function loadMore() {
  if (loading.value || (initialLoaded.value && done.value)) return
  loading.value = true
  try {
    const res = await $fetch<{ total: number; page: number; pageSize: number; items: LevelRow[] }>(
      '/api/levels',
      { query: { page: nextPage.value, pageSize: PAGE_SIZE, search: search.value } },
    )
    total.value = res.total
    items.value.push(...res.items)
    nextPage.value += 1
    initialLoaded.value = true
  } finally {
    loading.value = false
  }
}

function reset() {
  items.value = []
  nextPage.value = 1
  total.value = 0
  initialLoaded.value = false
}

// Initial load
await loadMore()

// Search debouncing
let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(async () => {
    router.replace({ query: { ...route.query, q: v || undefined } })
    reset()
    await loadMore()
  }, 200)
})

// Infinite scroll: observe a sentinel near the bottom of the list
const sentinel = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!sentinel.value || !scrollEl.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) loadMore()
    },
    { root: scrollEl.value, rootMargin: '300px 0px' },
  )
  observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())

// Auto-scroll active item into view
watch(
  () => props.activePosition,
  async (pos) => {
    if (pos == null) return
    await nextTick()
    const el = scrollEl.value?.querySelector<HTMLElement>(`[data-pos="${pos}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800 shrink-0">
      <div class="flex items-center gap-2 mb-3 px-1">
        <span class="text-xs uppercase tracking-widest text-accent font-semibold">Classic</span>
      </div>
      <input
        v-model="search"
        type="search"
        placeholder="Search…"
        class="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <ul class="divide-y divide-zinc-900/60">
        <li v-for="lvl in items" :key="lvl.position" :data-pos="lvl.position">
          <NuxtLink
            :to="{ path: `/levels/${lvl.position}`, query: search ? { q: search } : {} }"
            class="flex items-center gap-2 pr-3 py-1.5 text-sm transition-colors group"
            :style="lvl.position === activePosition
              ? { backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }
              : undefined"
            :class="lvl.position === activePosition ? '' : 'text-zinc-300 hover:bg-zinc-900/70'"
          >
            <span
              class="text-[11px] tabular-nums px-2 py-1 w-14 shrink-0 text-center font-medium"
              :style="{ backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }"
            >
              #{{ lvl.position }}
            </span>
            <span class="truncate">{{ lvl.name }}</span>
          </NuxtLink>
        </li>
        <li v-if="initialLoaded && items.length === 0" class="px-3 py-6 text-xs text-zinc-500 text-center">
          No matches.
        </li>
      </ul>

      <!-- Sentinel + loading state -->
      <div ref="sentinel" class="px-3 py-3 text-[11px] text-zinc-600 text-center">
        <span v-if="loading">loading…</span>
        <span v-else-if="done && items.length > 0">{{ total.toLocaleString() }} levels — end of list</span>
        <span v-else-if="done && items.length === 0"></span>
        <span v-else>↓ scroll for more</span>
      </div>
    </div>
  </aside>
</template>

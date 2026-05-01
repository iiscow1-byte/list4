<script setup lang="ts">
type AwaitingRow = {
  id: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  difficulty: string | null
  main_skillset: string | null
  approved_at: string
}

const props = defineProps<{ activeId?: number | null }>()

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 500
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const items = ref<AwaitingRow[]>([])
const total = ref(0)
const nextPage = ref(1)
const loading = ref(false)
const initialLoaded = ref(false)
const done = computed(() => items.value.length >= total.value && initialLoaded.value)

async function loadMore() {
  if (loading.value || (initialLoaded.value && done.value)) return
  loading.value = true
  try {
    const res = await $fetch<{ total: number; items: AwaitingRow[] }>('/api/awaiting/levels', {
      query: { page: nextPage.value, pageSize: PAGE_SIZE, search: search.value },
    })
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

await loadMore()

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(async () => {
    router.replace({ query: { ...route.query, q: v || undefined } })
    reset()
    await loadMore()
  }, 200)
})

const sentinel = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!sentinel.value || !scrollEl.value) return
  observer = new IntersectionObserver(
    (entries) => { if (entries[0]?.isIntersecting) loadMore() },
    { root: scrollEl.value, rootMargin: '300px 0px' },
  )
  observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())

watch(
  () => props.activeId,
  async (id) => {
    if (id == null) return
    await nextTick()
    const el = scrollEl.value?.querySelector<HTMLElement>(`[data-id="${id}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800 shrink-0">
      <div class="flex items-center gap-2 mb-3 px-1">
        <span class="text-xs uppercase tracking-widest text-sky-300 font-semibold">Awaiting</span>
        <span class="text-[10px] text-zinc-500 normal-case tracking-normal">— approved, not yet placed</span>
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
        <li v-for="lvl in items" :key="lvl.id" :data-id="lvl.id">
          <NuxtLink
            :to="{ path: `/awaiting/${lvl.id}`, query: search ? { q: search } : {} }"
            class="flex items-center gap-2 pr-3 py-1.5 text-sm transition-colors group"
            :class="lvl.id === activeId
              ? 'bg-sky-900/40 text-sky-100'
              : 'text-zinc-300 hover:bg-zinc-900/70'"
          >
            <span class="text-[10px] uppercase tracking-widest px-2 py-1 w-14 shrink-0 text-center font-medium bg-zinc-900 text-zinc-400">
              {{ lvl.gddl_tier ?? lvl.difficulty ?? '—' }}
            </span>
            <span class="truncate flex-1 min-w-0">{{ lvl.name }}</span>
          </NuxtLink>
        </li>
        <li v-if="initialLoaded && items.length === 0" class="px-3 py-6 text-xs text-zinc-500 text-center">
          No matches.
        </li>
      </ul>

      <div ref="sentinel" class="px-3 py-3 text-[11px] text-zinc-600 text-center">
        <span v-if="loading">loading…</span>
        <span v-else-if="done && items.length > 0">{{ total.toLocaleString() }} levels</span>
        <span v-else>↓ scroll for more</span>
      </div>
    </div>
  </aside>
</template>

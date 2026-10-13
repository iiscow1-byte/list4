<script setup lang="ts">
type VoidRow = {
  position: number
  name: string
  demon_ranking: string | null
  days: number | null
  gd_id?: number | null
  verification_url?: string | null
}

const showThumbs = useShowThumbnails()

const props = defineProps<{ activePosition?: number | null }>()

const route = useRoute()
const setQuery = useQuerySync()

const PAGE_SIZE = 500
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const items = ref<VoidRow[]>([])
const total = ref(0)
const nextPage = ref(1)
const loading = ref(false)
const initialLoaded = ref(false)
const done = computed(() => items.value.length >= total.value && initialLoaded.value)

async function loadMore() {
  if (loading.value || (initialLoaded.value && done.value)) return
  loading.value = true
  try {
    const res = await $fetch<{ total: number; items: VoidRow[] }>('/api/void/levels', {
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
    setQuery({ q: v })
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
  () => props.activePosition,
  async (pos) => {
    if (pos == null) return
    await nextTick()
    const el = scrollEl.value?.querySelector<HTMLElement>(`[data-pos="${pos}"]`)
    scrollWithin(scrollEl.value, el, 'nearest')
  },
  { immediate: true },
)
</script>

<template>
  <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
    <div class="px-3 pt-3 pb-2.5 border-b border-zinc-800 shrink-0 space-y-2">
      <div class="flex items-baseline gap-2">
        <h2 class="font-display font-semibold text-zinc-50">Void list</h2>
        <span class="ml-auto text-xs text-zinc-500 tabular-nums">{{ total.toLocaleString() }} levels</span>
      </div>
      <input v-model="search" type="search" placeholder="Find a level" aria-label="Find a level" class="field field-sm" />
    </div>

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <ul class="p-1.5 space-y-1">
        <li v-for="lvl in items" :key="lvl.position" :data-pos="lvl.position" class="list-item">
          <LevelRow
            :to="{ path: `/void/${lvl.position}`, query: search ? { q: search } : {} }"
            :rank="`#${lvl.position}`"
            :name="lvl.name"
            color="#a21caf"
            :gd-id="lvl.gd_id"
            :video-url="lvl.verification_url"
            :thumbs="showThumbs"
            :active="lvl.position === activePosition"
          >
            <template v-if="lvl.days != null" #trailing>
              <span class="text-[11px] tabular-nums text-zinc-400" :title="`${lvl.days} days in the void`">{{ lvl.days.toLocaleString() }}d</span>
            </template>
          </LevelRow>
        </li>
        <li v-if="initialLoaded && items.length === 0" class="px-3 py-8 text-sm text-zinc-500 text-center">No levels match.</li>
      </ul>
      <div ref="sentinel" class="px-3 py-3 text-xs text-zinc-600 text-center">
        <span v-if="loading">Loading…</span>
      </div>
    </div>
  </aside>
</template>

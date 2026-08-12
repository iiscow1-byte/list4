<script setup lang="ts">
type VoidRow = { position: number; name: string; demon_ranking: string | null; days: number | null }

const props = defineProps<{ activePosition?: number | null }>()

const route = useRoute()
const router = useRouter()

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
        <span class="text-xs uppercase tracking-widest text-fuchsia-300 font-semibold">Void</span>
        <span class="text-[10px] text-zinc-500 normal-case tracking-normal">— no difficulty opinion</span>
      </div>
      <input
        v-model="search"
        type="search"
        placeholder="Search…"
        class="field field-sm text-xs"
      />
    </div>

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <ul class="p-1.5 space-y-1">
        <li v-for="lvl in items" :key="lvl.position" :data-pos="lvl.position">
          <NuxtLink
            :to="{ path: `/void/${lvl.position}`, query: search ? { q: search } : {} }"
            class="relative overflow-hidden flex items-center gap-2.5 pl-1.5 pr-2.5 py-1.5 text-sm rounded-lg group transition-all"
            :class="lvl.position === activePosition
              ? 'ring-2 ring-inset ring-fuchsia-400 text-zinc-50 bg-zinc-900'
              : 'text-zinc-300 hover:text-zinc-50 ring-1 ring-inset ring-transparent hover:ring-zinc-700/60 hover:bg-zinc-900/50'"
          >
            <LevelThumbBg
              :gd-id="lvl.gd_id"
              :video-url="lvl.verification_url"
              res="small"
              :img-class="lvl.position === activePosition ? 'opacity-60' : 'opacity-30 group-hover:opacity-55'"
              overlay-class="bg-gradient-to-r from-zinc-950/90 via-zinc-950/55 to-zinc-950/15"
            />
            <span class="relative text-[11px] tabular-nums px-1 py-1 w-14 shrink-0 text-center font-semibold rounded-md shadow-sm bg-zinc-900 text-fuchsia-300">
              #{{ lvl.position }}
            </span>
            <span class="relative truncate flex-1 min-w-0 font-medium drop-shadow-sm">{{ lvl.name }}</span>
            <span v-if="lvl.days != null" class="relative shrink-0 text-[10px] tabular-nums text-zinc-500">
              {{ lvl.days.toLocaleString() }}d
            </span>
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

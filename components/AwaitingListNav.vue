<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { parseTierShortcut } from '~/utils/tier-shortcut'

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
const TIER_MAX_ORD = 44

const SORTS = [
  { value: 'tier_desc',      label: 'Tier (hardest first)' },
  { value: 'tier_asc',       label: 'Tier (easiest first)' },
  { value: 'approved_desc',  label: 'Approved (newest)' },
  { value: 'approved_asc',   label: 'Approved (oldest)' },
  { value: 'name_asc',       label: 'Name (A → Z)' },
  { value: 'verify_desc',    label: 'Verify date (newest)' },
  { value: 'verify_asc',     label: 'Verify date (oldest)' },
  { value: 'enjoyment_desc', label: 'Enjoyment (highest)' },
  { value: 'enjoyment_asc',  label: 'Enjoyment (lowest)' },
] as const

const TAGS = ['old', 'uldm', 'buffed', 'nerfed'] as const

function tierNameToOrd(name: string): number | null {
  const sub = name.match(/^Subtier (\d{1,2})$/)
  if (sub) return Number(sub[1])
  const t = name.match(/^Tier (\d{1,2})$/)
  if (t) return 5 + Number(t[1])
  return null
}

function ordToTier(ord: number): string {
  if (ord <= 5) return `Subtier ${ord}`
  return `Tier ${ord - 5}`
}

const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const filtersOpen = ref(false)

const tierMin = ref(0)
const tierMax = ref(TIER_MAX_ORD)
const tagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })
const verifier = ref('')
const skillset = ref('')
const verifyFrom = ref('')
const verifyTo = ref('')
const enjoyMin = ref<string>('')
const enjoyMax = ref<string>('')
const sort = ref<typeof SORTS[number]['value']>('tier_desc')

const activeFilterCount = computed(() => {
  let n = 0
  if (tierMin.value > 0 || tierMax.value < TIER_MAX_ORD) n++
  if (TAGS.some((t) => tagSet[t])) n++
  if (verifier.value.trim()) n++
  if (skillset.value.trim()) n++
  if (verifyFrom.value || verifyTo.value) n++
  if (enjoyMin.value !== '' || enjoyMax.value !== '') n++
  if (sort.value !== 'tier_desc') n++
  return n
})

const items = ref<AwaitingRow[]>([])
const total = ref(0)
const nextPage = ref(1)
const loading = ref(false)
const initialLoaded = ref(false)
const done = computed(() => items.value.length >= total.value && initialLoaded.value)

function buildQuery() {
  const tags = TAGS.filter((t) => tagSet[t])
  return {
    page: nextPage.value,
    pageSize: PAGE_SIZE,
    search: search.value || undefined,
    tierMin: tierMin.value > 0 ? tierMin.value : undefined,
    tierMax: tierMax.value < TIER_MAX_ORD ? tierMax.value : undefined,
    tags: tags.length ? tags.join(',') : undefined,
    verifier: verifier.value.trim() || undefined,
    skillset: skillset.value.trim() || undefined,
    verifyFrom: verifyFrom.value || undefined,
    verifyTo: verifyTo.value || undefined,
    enjoyMin: enjoyMin.value !== '' ? enjoyMin.value : undefined,
    enjoyMax: enjoyMax.value !== '' ? enjoyMax.value : undefined,
    sort: sort.value,
  }
}

async function loadMore() {
  if (loading.value || (initialLoaded.value && done.value)) return
  loading.value = true
  try {
    const res = await $fetch<{ total: number; items: AwaitingRow[] }>('/api/awaiting/levels', {
      query: buildQuery(),
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

function resetFilters() {
  tierMin.value = 0
  tierMax.value = TIER_MAX_ORD
  for (const t of TAGS) tagSet[t] = false
  verifier.value = ''
  skillset.value = ''
  verifyFrom.value = ''
  verifyTo.value = ''
  enjoyMin.value = ''
  enjoyMax.value = ''
  sort.value = 'tier_desc'
}

await loadMore()

let debounce: ReturnType<typeof setTimeout> | null = null
function refilter(immediate = false) {
  if (debounce) clearTimeout(debounce)
  const run = async () => {
    const tierResult = parseTierShortcut(search.value)
    if (tierResult) {
      const ord = tierNameToOrd(tierResult.tier)
      if (ord !== null) {
        search.value = ''
        tierMin.value = ord
        tierMax.value = ord
        reset()
        await loadMore()
        await nextTick()
        const els = scrollEl.value?.querySelectorAll<HTMLElement>('[data-id]')
        if (els && els.length > 0) {
          const idx = Math.min(els.length - 1, Math.floor((1 - tierResult.frac) * els.length))
          els[idx]?.scrollIntoView({ block: 'center' })
        }
        return
      }
    }
    router.replace({ query: { ...route.query, q: search.value || undefined } })
    reset()
    await loadMore()
  }
  if (immediate) run()
  else debounce = setTimeout(run, 200)
}

watch(search, () => refilter())
watch(verifier, () => refilter())
watch(skillset, () => refilter())
watch(enjoyMin, () => refilter())
watch(enjoyMax, () => refilter())
watch(verifyFrom, () => refilter(true))
watch(verifyTo, () => refilter(true))
watch(sort, () => refilter(true))
watch(tierMin, () => { if (tierMin.value > tierMax.value) tierMin.value = tierMax.value; refilter() })
watch(tierMax, () => { if (tierMax.value < tierMin.value) tierMax.value = tierMin.value; refilter() })
watch(tagSet, () => refilter(true), { deep: true })

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

      <div class="flex items-stretch gap-1.5">
        <input
          v-model="search"
          type="search"
          placeholder="Search… [Tier], #placement, ID"
          class="flex-1 min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          class="shrink-0 px-2 rounded border text-xs font-medium transition-colors flex items-center gap-1"
          :class="filtersOpen || activeFilterCount
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'"
          :aria-expanded="filtersOpen"
          aria-label="Advanced search"
          title="Advanced search"
          @click="filtersOpen = !filtersOpen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
            <path d="M3 4h18l-7 9v6l-4 2v-8z" />
          </svg>
          <span v-if="activeFilterCount" class="tabular-nums">{{ activeFilterCount }}</span>
        </button>
      </div>

      <div v-if="filtersOpen" class="mt-3 space-y-3 text-xs">
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty</span>
            <span class="text-[10px] text-zinc-400 tabular-nums">{{ ordToTier(tierMin) }} → {{ ordToTier(tierMax) }}</span>
          </div>
          <div class="relative h-6">
            <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded bg-zinc-800" />
            <div
              class="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-accent/70"
              :style="{
                left: `${(tierMin / TIER_MAX_ORD) * 100}%`,
                right: `${100 - (tierMax / TIER_MAX_ORD) * 100}%`,
              }"
            />
            <input
              v-model.number="tierMin"
              type="range" :min="0" :max="TIER_MAX_ORD" step="1"
              class="range-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none"
            />
            <input
              v-model.number="tierMax"
              type="range" :min="0" :max="TIER_MAX_ORD" step="1"
              class="range-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none"
            />
          </div>
        </div>

        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Tags</div>
          <div class="flex flex-wrap gap-1.5">
            <label
              v-for="t in TAGS" :key="t"
              class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
              :class="tagSet[t]
                ? 'border-accent/60 text-accent bg-accent/10'
                : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
            >
              <input v-model="tagSet[t]" type="checkbox" class="sr-only" />
              {{ t === 'uldm' ? 'ULDM' : t }}
            </label>
          </div>
        </div>

        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verifier</span>
          <input
            v-model="verifier"
            type="text" placeholder="Verifier name"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Main skillset</span>
          <input
            v-model="skillset"
            type="text" placeholder="e.g. memory, timing"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Verify date</div>
          <div class="flex items-center gap-1.5">
            <input
              v-model="verifyFrom" type="date"
              class="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span class="text-zinc-600">→</span>
            <input
              v-model="verifyTo" type="date"
              class="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <div>
          <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Enjoyment</div>
          <div class="flex items-center gap-1.5">
            <input
              v-model="enjoyMin" type="number" inputmode="decimal" min="0" max="10" step="0.1" placeholder="min"
              class="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span class="text-zinc-600">→</span>
            <input
              v-model="enjoyMax" type="number" inputmode="decimal" min="0" max="10" step="0.1" placeholder="max"
              class="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Sort by</span>
          <select
            v-model="sort"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option v-for="s in SORTS" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </label>

        <div class="flex items-center justify-between pt-1">
          <button
            type="button"
            class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
            @click="resetFilters"
          >Reset filters</button>
        </div>
      </div>
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
            <span
              class="text-[10px] tabular-nums px-2 py-1 w-20 shrink-0 text-center font-medium whitespace-nowrap"
              :style="{ backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }"
            >
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

<style scoped>
.range-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 100%;
}
.range-thumb::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  pointer-events: auto;
  width: 14px; height: 14px;
  border-radius: 9999px;
  background: rgb(244 196 48);
  border: 2px solid rgb(24 24 27);
  cursor: pointer;
}
.range-thumb::-moz-range-thumb {
  pointer-events: auto;
  width: 14px; height: 14px;
  border-radius: 9999px;
  background: rgb(244 196 48);
  border: 2px solid rgb(24 24 27);
  cursor: pointer;
}
.range-thumb::-webkit-slider-runnable-track { background: transparent; }
.range-thumb::-moz-range-track { background: transparent; }
</style>

<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { parseTierShortcut } from '~/utils/tier-shortcut'

type LevelRow = {
  position: number
  name: string
  difficulty: string | null
  points: number | null
  gddl_tier: string | null
  gddl_tier_frac?: number | null
  displayRank?: number
  aredl_position?: number | null
  pointercrate_position?: number | null
  gdl_position?: number | null
  challenge_list_position?: number | null
}

const props = defineProps<{
  activePosition?: number | null
  pickMode?: boolean
  pickedPosition?: number | null
}>()
const emit = defineEmits<{ (e: 'pick', level: LevelRow): void }>()

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 500
const TIER_MAX_ORD = 44   // Subtier 0..5 → 0..5 ; Tier 1..39 → 6..44

const SORTS = [
  { value: 'position',       label: 'List position (hardest first)' },
  { value: 'name_asc',       label: 'Name (A → Z)' },
  { value: 'verify_desc',    label: 'Verify date (newest)' },
  { value: 'verify_asc',     label: 'Verify date (oldest)' },
  { value: 'enjoyment_desc', label: 'Enjoyment (highest)' },
  { value: 'enjoyment_asc',  label: 'Enjoyment (lowest)' },
  { value: 'added_desc',     label: 'Added (newest)' },
  { value: 'added_asc',      label: 'Added (oldest)' },
  { value: 'rating_desc',    label: 'Rating (highest)' },
  { value: 'rating_asc',     label: 'Rating (lowest)' },
] as const

const TAGS = ['old', 'uldm', 'buffed', 'nerfed'] as const
const RATINGS = ['Challenge', 'Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'] as const
// Skillset options match the submit form's SKILLSET_OPTIONS so users see the
// same vocabulary in both places. Sorted alphabetically for the dropdown.
const SKILLSETS = [
  'Ball', 'Chokepoints', 'Consistency', 'Controlled Spam', 'Cube', 'Duals',
  'Endurance', 'Fast Paced', 'Flow', 'Framelocked', 'High CPS', 'Learny',
  'Memory', 'Nerve Control', 'Overall', 'Robot', 'Ship', 'Ship Control',
  'Solo 2P', 'Spam', 'Spider', 'Straight Fly', 'Swingcopter', 'Timings',
  'UFO', 'Wave',
] as const

function ordToTier(ord: number): string {
  if (ord <= 5) return `Subtier ${ord}`
  return `Tier ${ord - 5}`
}

const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const filtersOpen = ref(false)

function closeFilters() { filtersOpen.value = false }
function onFiltersKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && filtersOpen.value) closeFilters()
}
onMounted(() => window.addEventListener('keydown', onFiltersKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onFiltersKeydown))

const tierMin = ref(0)
const tierMax = ref(TIER_MAX_ORD)
const tagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })
const skillsetSet = reactive<Record<string, boolean>>(
  Object.fromEntries(SKILLSETS.map((s) => [s, false])),
)
type AltVersionMode = 'show' | 'hide' | 'only'
// `altVersions` filters on `same_as_above` (UI label: Duplicates).
// `alternates` filters on the new `is_alternate` flag.
// `tentativePlacements` filters on the `tentative_placement` flag.
const altVersions = ref<AltVersionMode>('show')
const alternates = ref<AltVersionMode>('show')
const tentativePlacements = ref<AltVersionMode>('show')
const creator = ref('')
const sourceFilter = ref('')
const sources = ref<{ source: string; count: number }[]>([])
const verifyFrom = ref('')
const verifyTo = ref('')
const ratingSet = reactive<Record<string, boolean>>(
  Object.fromEntries(RATINGS.map((r) => [r, false])),
)
const enjoyMin = ref(0)
const enjoyMax = ref(10)
const sort = ref<typeof SORTS[number]['value']>('position')
const rankByFilter = ref(false)
const showTierDecimal = useTierDecimal()
const showTierInList = ref(false)

function tierToOrd(tier: string | null): number | null {
  if (!tier) return null
  const sm = tier.match(/^Subtier (\d+)$/)
  if (sm) return Number(sm[1])
  const tm = tier.match(/^Tier (\d+)$/)
  if (tm) return 5 + Number(tm[1])
  return null
}

function tierTextLabel(lvl: LevelRow): string | null {
  if (!showTierInList.value) return null
  const tier = lvl.gddl_tier
  if (!tier) return null
  if (showTierDecimal.value) {
    const frac = lvl.gddl_tier_frac
    if (frac != null) {
      const ord = tierToOrd(tier)
      if (ord !== null && ord < TIER_MAX_ORD) {
        const sm = tier.match(/^Subtier (\d+)$/)
        const tm = tier.match(/^Tier (\d+)$/)
        const num = sm ? Number(sm[1]) : tm ? Number(tm[1]) : null
        if (num !== null) return `${sm ? 'Subtier ' : 'Tier '}${(num + frac).toFixed(2)}`
      }
    }
  }
  return tier
}

type ListVariant = 'Classic' | 'Rated' | 'Challenge' | 'AREDL' | 'GDL' | 'CL'
const listVariant = ref<ListVariant>('Classic')
const externalList = ref('')

function applyVariant(v: ListVariant) {
  listVariant.value = v
  for (const r of RATINGS) ratingSet[r] = false
  externalList.value = ''
  sort.value = 'position'
  rankByFilter.value = false
  if (v === 'Rated') {
    ratingSet['Rated'] = true
    ratingSet['Featured'] = true
    ratingSet['Epic'] = true
    ratingSet['Legendary'] = true
    ratingSet['Mythic'] = true
    rankByFilter.value = true
  } else if (v === 'Challenge') {
    ratingSet['Challenge'] = true
    rankByFilter.value = true
  } else if (v === 'AREDL') {
    externalList.value = 'aredl'
    sort.value = 'aredl_asc'
  } else if (v === 'GDL') {
    externalList.value = 'gdl'
    sort.value = 'gdl_asc'
  } else if (v === 'CL') {
    externalList.value = 'cl'
    sort.value = 'cl_asc'
  }
}

function displayNum(lvl: LevelRow): number {
  if (listVariant.value === 'AREDL' && lvl.aredl_position != null) return lvl.aredl_position
  if (listVariant.value === 'GDL' && lvl.gdl_position != null) return lvl.gdl_position
  if (listVariant.value === 'CL' && lvl.challenge_list_position != null) return lvl.challenge_list_position
  return lvl.displayRank ?? lvl.position
}

const activeFilterCount = computed(() => {
  let n = 0
  if (tierMin.value > 0 || tierMax.value < TIER_MAX_ORD) n++
  if (TAGS.some((t) => tagSet[t]) || SKILLSETS.some((s) => skillsetSet[s]) || altVersions.value !== 'show' || alternates.value !== 'show' || tentativePlacements.value !== 'show') n++
  if (creator.value.trim()) n++
  if (sourceFilter.value) n++
  if (verifyFrom.value || verifyTo.value) n++
  if (RATINGS.some((r) => ratingSet[r])) n++
  if (enjoyMin.value > 0 || enjoyMax.value < 10) n++
  if (sort.value !== 'position') n++
  if (rankByFilter.value) n++
  return n
})

const tagsDropdownActiveCount = computed(() => {
  let n = 0
  for (const t of TAGS) if (tagSet[t]) n++
  for (const s of SKILLSETS) if (skillsetSet[s]) n++
  if (altVersions.value !== 'show') n++
  if (alternates.value !== 'show') n++
  if (tentativePlacements.value !== 'show') n++
  return n
})

const items = ref<LevelRow[]>([])
const total = ref(0)
const challengeMode = ref(false)
const nextPage = ref(1)
const loading = ref(false)
const initialLoaded = ref(false)
const done = computed(() => items.value.length >= total.value && initialLoaded.value)

function buildQuery() {
  const tags = TAGS.filter((t) => tagSet[t])
  const skillsets = SKILLSETS.filter((s) => skillsetSet[s])
  const ratings = RATINGS.filter((r) => ratingSet[r])
  return {
    page: nextPage.value,
    pageSize: PAGE_SIZE,
    search: search.value || undefined,
    tierMin: tierMin.value > 0 ? tierMin.value : undefined,
    tierMax: tierMax.value < TIER_MAX_ORD ? tierMax.value : undefined,
    tags: tags.length ? tags.join(',') : undefined,
    skillsets: skillsets.length ? skillsets.join(',') : undefined,
    altVersions: altVersions.value !== 'show' ? altVersions.value : undefined,
    alternates: alternates.value !== 'show' ? alternates.value : undefined,
    tentativePlacements: tentativePlacements.value !== 'show' ? tentativePlacements.value : undefined,
    creator: creator.value.trim() || undefined,
    source: sourceFilter.value || undefined,
    verifyFrom: verifyFrom.value || undefined,
    verifyTo: verifyTo.value || undefined,
    ratings: ratings.length ? ratings.join(',') : undefined,
    enjoyMin: enjoyMin.value > 0 ? enjoyMin.value : undefined,
    enjoyMax: enjoyMax.value < 10 ? enjoyMax.value : undefined,
    sort: sort.value !== 'position' ? sort.value : undefined,
    rankByFilter: rankByFilter.value ? 1 : undefined,
    externalList: externalList.value || undefined,
    tierFrac: showTierInList.value ? 1 : undefined,
  }
}

async function loadMore() {
  if (loading.value || (initialLoaded.value && done.value)) return
  loading.value = true
  try {
    const res = await $fetch<{ total: number; page: number; pageSize: number; items: LevelRow[]; challengeMode: boolean }>(
      '/api/levels',
      { query: buildQuery() },
    )
    total.value = res.total
    challengeMode.value = !!res.challengeMode
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
  for (const s of SKILLSETS) skillsetSet[s] = false
  altVersions.value = 'show'
  alternates.value = 'show'
  tentativePlacements.value = 'show'
  creator.value = ''
  sourceFilter.value = ''
  verifyFrom.value = ''
  verifyTo.value = ''
  for (const r of RATINGS) ratingSet[r] = false
  enjoyMin.value = 0
  enjoyMax.value = 10
  sort.value = 'position'
  rankByFilter.value = false
  showTierInList.value = false
  listVariant.value = 'Classic'
  externalList.value = ''
}

// Initial load
await loadMore()

let debounce: ReturnType<typeof setTimeout> | null = null
let lastGdIdLookup = ''
let lastTierLookup = ''
let lastPositionLookup = 0
let suppressNextRefilter = false

async function jumpToPosition(pos: number) {
  suppressNextRefilter = true
  search.value = ''
  if (!props.pickMode) await navigateTo(`/levels/${pos}`)
  reset()
  nextPage.value = Math.max(1, Math.ceil(pos / PAGE_SIZE))
  await loadMore()
  await nextTick()
  scrollEl.value?.querySelector<HTMLElement>(`[data-pos="${pos}"]`)
    ?.scrollIntoView({ block: 'center' })
}

async function maybeJumpToTier(): Promise<boolean> {
  const result = parseTierShortcut(search.value)
  if (!result) return false
  const lookupKey = `${result.tier}|${result.frac}`
  if (lookupKey === lastTierLookup) return false
  lastTierLookup = lookupKey
  try {
    const res = await $fetch<{ tier: string; count: number; midpoint: number | null }>(
      '/api/levels/tier-midpoint', { query: { tier: result.tier, frac: 1 - result.frac } },
    )
    if (res?.midpoint) {
      lastTierLookup = ''
      await jumpToPosition(res.midpoint)
      return true
    }
  } catch { /* non-fatal */ }
  lastTierLookup = ''
  return false
}

async function maybeJumpToPosition(): Promise<boolean> {
  const q = search.value.trim()
  const m = q.match(/^#(\d+)$/)
  if (!m) return false
  const pos = Number(m[1])
  if (!Number.isInteger(pos) || pos <= 0) return false
  if (pos === lastPositionLookup) return false
  lastPositionLookup = pos
  await jumpToPosition(pos)
  lastPositionLookup = 0
  return true
}

async function maybeJumpToGdId(): Promise<boolean> {
  // If the user typed/pasted a pure positive integer that matches a level's
  // gd_id, jump straight to that level's page. Don't repeat the lookup for
  // the same input on rapid keystrokes.
  const q = search.value.trim()
  if (!/^\d+$/.test(q)) return false
  const n = Number(q)
  if (!Number.isInteger(n) || n <= 0) return false
  if (q === lastGdIdLookup) return false
  lastGdIdLookup = q
  try {
    const res = await $fetch<{ position: number; name: string }>(
      `/api/levels/by-gd-id/${n}`,
    )
    if (res?.position) {
      await jumpToPosition(res.position)
      return true
    }
  } catch {
    // 404 is the expected miss — fall through to normal search.
  }
  return false
}

function refilter(immediate = false) {
  if (debounce) clearTimeout(debounce)
  if (suppressNextRefilter) { suppressNextRefilter = false; return }
  const run = async () => {
    if (await maybeJumpToTier()) return
    if (await maybeJumpToPosition()) return
    if (await maybeJumpToGdId()) return
    router.replace({ query: { ...route.query, q: search.value || undefined } })
    reset()
    await loadMore()
  }
  if (immediate) run()
  else debounce = setTimeout(run, 400)
}

watch(search, () => refilter())
watch(creator, () => refilter())
watch(sourceFilter, () => refilter(true))
watch(enjoyMin, () => refilter())
watch(enjoyMax, () => refilter())
watch(verifyFrom, () => refilter(true))
watch(verifyTo, () => refilter(true))
watch(sort, () => refilter(true))
watch(tierMin, () => { if (tierMin.value > tierMax.value) tierMin.value = tierMax.value; refilter() })
watch(tierMax, () => { if (tierMax.value < tierMin.value) tierMax.value = tierMin.value; refilter() })
watch(tagSet,    () => refilter(true), { deep: true })
watch(skillsetSet, () => refilter(true), { deep: true })
watch(altVersions, () => refilter(true))
watch(alternates, () => refilter(true))
watch(tentativePlacements, () => refilter(true))
watch(ratingSet, () => refilter(true), { deep: true })
watch(rankByFilter, () => refilter(true))
watch(showTierInList, () => refilter(true))

// Infinite scroll
const sentinel = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(async () => {
  if (sentinel.value && scrollEl.value) {
    observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore() },
      { root: scrollEl.value, rootMargin: '300px 0px' },
    )
    observer.observe(sentinel.value)
  }
  try {
    const res = await $fetch<{ sources: { source: string; count: number }[] }>('/api/levels/sources')
    sources.value = res.sources
  } catch { /* non-fatal */ }
})
onBeforeUnmount(() => observer?.disconnect())

// Poll for list changes every 60s and reload automatically when the stamp changes.
let pollStamp = -1
let pollTimer: ReturnType<typeof setInterval> | null = null
async function checkVersion() {
  try {
    const res = await $fetch<{ stamp: number }>('/api/levels/version')
    if (pollStamp === -1) { pollStamp = res.stamp; return }
    if (res.stamp !== pollStamp) {
      pollStamp = res.stamp
      refilter(true)
    }
  } catch { /* non-fatal */ }
}
onMounted(() => { pollTimer = setInterval(checkVersion, 60_000) })
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })

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

// Scroll to picked position when in pick mode
watch(
  () => props.pickedPosition,
  async (pos) => {
    if (pos == null) return
    await nextTick()
    const el = scrollEl.value?.querySelector<HTMLElement>(`[data-pos="${pos}"]`)
    if (el) { el.scrollIntoView({ block: 'center' }); return }
    // Item not yet loaded — load forward until it appears
    while (!done.value) {
      await loadMore()
      await nextTick()
      const found = scrollEl.value?.querySelector<HTMLElement>(`[data-pos="${pos}"]`)
      if (found) { found.scrollIntoView({ block: 'center' }); return }
    }
  },
)
</script>

<template>
  <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
    <div v-if="pickMode" class="px-3 py-2 bg-accent/10 border-b border-accent/30 shrink-0 flex items-center gap-2">
      <span class="text-[11px] text-accent leading-snug flex-1">← Click a level to place current level below it</span>
    </div>
    <div class="p-3 border-b border-zinc-800 shrink-0">
      <div class="flex items-center gap-2 mb-3 px-1">
        <span class="text-xs uppercase tracking-widest text-accent font-semibold">{{ listVariant }}</span>
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

    </div>

    <!-- Advanced filter popup -->
    <Teleport to="body">
      <div
        v-if="filtersOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        @click.self="closeFilters"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Advanced search"
          class="relative w-full max-w-4xl max-h-[90vh] rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <div class="flex items-center gap-2">
              <h2 class="text-xs uppercase tracking-widest text-zinc-200 font-semibold">Advanced search</h2>
              <span v-if="activeFilterCount" class="text-[10px] text-accent normal-case tracking-normal">
                {{ activeFilterCount }} active
              </span>
              <span v-if="challengeMode" class="text-[10px] text-accent normal-case tracking-normal">
                — Showing challenge ranks
              </span>
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
                @click="resetFilters"
              >Reset filters</button>
              <button
                type="button"
                class="rounded p-1 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                aria-label="Close"
                @click="closeFilters"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-0 min-h-0 flex-1 overflow-hidden">
            <!-- Left column: general filters -->
            <div class="p-4 space-y-4 text-xs overflow-y-auto md:border-r border-zinc-800">
              <!-- List variants -->
              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">List variants</div>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="v in (['Classic', 'Challenge', 'Rated'] as const)"
                    :key="v"
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                    :class="listVariant === v
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                  >
                    <input type="radio" :value="v" :checked="listVariant === v" class="sr-only" @change="applyVariant(v)" />
                    {{ v }}
                  </label>
                </div>
              </div>

              <!-- External list rankings -->
              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Ranked by external list</div>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                    :class="listVariant === 'AREDL'
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                    title="Levels ranked on AREDL, sorted by their AREDL position"
                  >
                    <input type="radio" value="AREDL" :checked="listVariant === 'AREDL'" class="sr-only" @change="applyVariant('AREDL')" />
                    AREDL
                  </label>
                  <label
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                    :class="listVariant === 'GDL'
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                    title="Levels ranked on the Global Demon List, sorted by their GDL position"
                  >
                    <input type="radio" value="GDL" :checked="listVariant === 'GDL'" class="sr-only" @change="applyVariant('GDL')" />
                    GDL
                  </label>
                  <label
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                    :class="listVariant === 'CL'
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                    title="Levels ranked on the Challenge List, sorted by their CL position"
                  >
                    <input type="radio" value="CL" :checked="listVariant === 'CL'" class="sr-only" @change="applyVariant('CL')" />
                    CL
                  </label>
                </div>
              </div>

              <!-- Tier range -->
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

              <!-- Ratings -->
              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Rating</div>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="r in RATINGS" :key="r"
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                    :class="ratingSet[r]
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                  >
                    <input v-model="ratingSet[r]" type="checkbox" class="sr-only" />
                    {{ r }}
                  </label>
                </div>
              </div>

              <!-- Creator -->
              <label class="block">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Creator</span>
                <input
                  v-model="creator"
                  type="text" placeholder="Creator name"
                  class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>

              <!-- Source -->
              <div class="block">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Source</span>
                <SearchableSelect
                  v-model="sourceFilter"
                  :option-objects="sources.map(s => ({ label: `${s.source} (${s.count.toLocaleString()})`, value: s.source }))"
                  empty-label="All sources"
                  class="mt-1"
                  input-class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 pr-7 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <!-- Verify date range -->
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

              <!-- Enjoyment range -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Enjoyment</span>
                  <span class="text-[10px] text-zinc-400 tabular-nums">{{ enjoyMin }} → {{ enjoyMax }}</span>
                </div>
                <div class="relative h-6">
                  <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded bg-zinc-800" />
                  <div
                    class="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-accent/70"
                    :style="{
                      left: `${(enjoyMin / 10) * 100}%`,
                      right: `${100 - (enjoyMax / 10) * 100}%`,
                    }"
                  />
                  <input
                    v-model.number="enjoyMin"
                    type="range" :min="0" :max="10" step="0.5"
                    class="range-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none"
                  />
                  <input
                    v-model.number="enjoyMax"
                    type="range" :min="0" :max="10" step="0.5"
                    class="range-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none"
                  />
                </div>
              </div>

              <!-- Sort -->
              <div class="block">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Sort by</span>
                <SearchableSelect
                  v-model="sort"
                  :option-objects="[...SORTS]"
                  class="mt-1"
                  input-class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 pr-7 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

            </div>

            <!-- Right column: tags -->
            <div class="p-4 space-y-3 text-xs overflow-y-auto border-t md:border-t-0 border-zinc-800">
              <div class="flex items-center justify-between">
                <h3 class="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Tags</h3>
                <span v-if="tagsDropdownActiveCount" class="text-[10px] text-accent">{{ tagsDropdownActiveCount }} selected</span>
              </div>

              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Skillset</div>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="s in SKILLSETS" :key="s"
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                    :class="skillsetSet[s]
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                  >
                    <input v-model="skillsetSet[s]" type="checkbox" class="sr-only" />
                    {{ s }}
                  </label>
                </div>
              </div>

              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Tentative placements</div>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="opt in (['show', 'hide', 'only'] as const)"
                    :key="`tent-${opt}`"
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
                    :class="tentativePlacements === opt
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                  >
                    <input v-model="tentativePlacements" type="radio" :value="opt" class="sr-only" />
                    {{ opt }}
                  </label>
                </div>
                <p class="text-[10px] text-zinc-600 mt-1">Levels with uncertain placements on the list.</p>
              </div>

              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Duplicate levels</div>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="opt in (['show', 'hide', 'only'] as const)"
                    :key="opt"
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
                    :class="altVersions === opt
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                  >
                    <input v-model="altVersions" type="radio" :value="opt" class="sr-only" />
                    {{ opt }}
                  </label>
                </div>
                <p class="text-[10px] text-zinc-600 mt-1">Example: Red Slaughterhouse</p>
              </div>

              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Alternate versions</div>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="opt in (['show', 'hide', 'only'] as const)"
                    :key="`alt-${opt}`"
                    class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
                    :class="alternates === opt
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
                  >
                    <input v-model="alternates" type="radio" :value="opt" class="sr-only" />
                    {{ opt }}
                  </label>
                </div>
                <p class="text-[10px] text-zinc-600 mt-1">Example: Tidal Wave (Buffed)</p>
              </div>

              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Rank by filter</div>
                <label class="flex items-start gap-2 cursor-pointer select-none">
                  <input v-model="rankByFilter" type="checkbox" class="mt-0.5 accent-accent" />
                  <span class="text-[10px] text-zinc-500">
                    Numbers reflect each level's place within the filtered list rather than the global list.
                  </span>
                </label>
              </div>

              <div>
                <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Display</div>
                <div class="space-y-1.5">
                  <label class="flex items-start gap-2 cursor-pointer select-none">
                    <input v-model="showTierDecimal" type="checkbox" class="mt-0.5 accent-accent" />
                    <span class="text-[10px] text-zinc-500">
                      Show tier decimal — shows "Tier 20.75" instead of "Tier 20" in the level panel.
                    </span>
                  </label>
                  <label class="flex items-start gap-2 cursor-pointer select-none">
                    <input v-model="showTierInList" type="checkbox" class="mt-0.5 accent-accent" />
                    <span class="text-[10px] text-zinc-500">
                      Show tier in list — adds a tier label to each level row.
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <ul class="divide-y divide-zinc-900/60">
        <li v-for="lvl in items" :key="lvl.position" :data-pos="lvl.position">
          <!-- Pick mode: clickable button, no navigation -->
          <button
            v-if="pickMode"
            type="button"
            class="w-full flex items-center gap-2 pr-3 py-1.5 text-sm transition-colors"
            :style="lvl.position === pickedPosition
              ? { backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }
              : undefined"
            :class="lvl.position === pickedPosition
              ? 'ring-1 ring-inset ring-accent/80'
              : 'text-zinc-300 hover:bg-zinc-900/70'"
            @click="emit('pick', lvl)"
          >
            <span
              class="text-[11px] tabular-nums px-2 py-1 w-14 shrink-0 text-center font-medium"
              :style="{ backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }"
            >#{{ displayNum(lvl) }}</span>
            <span class="truncate flex-1">{{ lvl.name }}</span>
            <span v-if="tierTextLabel(lvl)" class="text-[10px] tabular-nums opacity-60 shrink-0">{{ tierTextLabel(lvl) }}</span>
          </button>
          <!-- Normal mode: NuxtLink navigation -->
          <NuxtLink
            v-else
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
              #{{ displayNum(lvl) }}
            </span>
            <span class="truncate flex-1">{{ lvl.name }}</span>
            <span v-if="tierTextLabel(lvl)" class="text-[10px] tabular-nums opacity-60 shrink-0">{{ tierTextLabel(lvl) }}</span>
          </NuxtLink>
        </li>
        <li v-if="initialLoaded && items.length === 0" class="px-3 py-6 text-xs text-zinc-500 text-center">
          No matches.
        </li>
      </ul>

      <div ref="sentinel" class="px-3 py-3 text-[11px] text-zinc-600 text-center">
        <span v-if="loading">loading…</span>
        <span v-else-if="done && items.length > 0">{{ total.toLocaleString() }} levels — end of list</span>
        <span v-else-if="done && items.length === 0"></span>
        <span v-else>↓ scroll for more</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Dual-handle range slider — both inputs share the same track and only their
   thumbs receive pointer events, so they can be dragged independently. */
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

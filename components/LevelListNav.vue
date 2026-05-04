<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type LevelRow = {
  position: number
  name: string
  difficulty: string | null
  points: number | null
  gddl_tier: string | null
  displayRank?: number
}

const props = defineProps<{ activePosition?: number | null }>()

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

const tierMin = ref(0)
const tierMax = ref(TIER_MAX_ORD)
const tagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })
const skillsetSet = reactive<Record<string, boolean>>(
  Object.fromEntries(SKILLSETS.map((s) => [s, false])),
)
type AltVersionMode = 'show' | 'hide' | 'only'
const altVersions = ref<AltVersionMode>('show')
const tagsDropdownOpen = ref(false)
const creator = ref('')
const sourceFilter = ref('')
const sources = ref<{ source: string; count: number }[]>([])
const verifyFrom = ref('')
const verifyTo = ref('')
const ratingSet = reactive<Record<string, boolean>>(
  Object.fromEntries(RATINGS.map((r) => [r, false])),
)
const enjoyMin = ref<string>('')
const enjoyMax = ref<string>('')
const sort = ref<typeof SORTS[number]['value']>('position')
const rankByFilter = ref(false)

const activeFilterCount = computed(() => {
  let n = 0
  if (tierMin.value > 0 || tierMax.value < TIER_MAX_ORD) n++
  if (TAGS.some((t) => tagSet[t]) || SKILLSETS.some((s) => skillsetSet[s]) || altVersions.value !== 'show') n++
  if (creator.value.trim()) n++
  if (sourceFilter.value) n++
  if (verifyFrom.value || verifyTo.value) n++
  if (RATINGS.some((r) => ratingSet[r])) n++
  if (enjoyMin.value !== '' || enjoyMax.value !== '') n++
  if (sort.value !== 'position') n++
  if (rankByFilter.value) n++
  return n
})

const tagsDropdownActiveCount = computed(() => {
  let n = 0
  for (const t of TAGS) if (tagSet[t]) n++
  for (const s of SKILLSETS) if (skillsetSet[s]) n++
  if (altVersions.value !== 'show') n++
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
    creator: creator.value.trim() || undefined,
    source: sourceFilter.value || undefined,
    verifyFrom: verifyFrom.value || undefined,
    verifyTo: verifyTo.value || undefined,
    ratings: ratings.length ? ratings.join(',') : undefined,
    enjoyMin: enjoyMin.value !== '' ? enjoyMin.value : undefined,
    enjoyMax: enjoyMax.value !== '' ? enjoyMax.value : undefined,
    sort: sort.value !== 'position' ? sort.value : undefined,
    rankByFilter: rankByFilter.value ? 1 : undefined,
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
  creator.value = ''
  sourceFilter.value = ''
  verifyFrom.value = ''
  verifyTo.value = ''
  for (const r of RATINGS) ratingSet[r] = false
  enjoyMin.value = ''
  enjoyMax.value = ''
  sort.value = 'position'
  rankByFilter.value = false
}

// Initial load
await loadMore()

let debounce: ReturnType<typeof setTimeout> | null = null
let lastGdIdLookup = ''
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
      await navigateTo(`/levels/${res.position}`)
      return true
    }
  } catch {
    // 404 is the expected miss — fall through to normal search.
  }
  return false
}

function refilter(immediate = false) {
  if (debounce) clearTimeout(debounce)
  const run = async () => {
    if (await maybeJumpToGdId()) return
    router.replace({ query: { ...route.query, q: search.value || undefined } })
    reset()
    await loadMore()
  }
  if (immediate) run()
  else debounce = setTimeout(run, 200)
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
watch(ratingSet, () => refilter(true), { deep: true })
watch(rankByFilter, () => refilter(true))

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

      <div class="flex items-stretch gap-1.5">
        <input
          v-model="search"
          type="search"
          placeholder="Search…"
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

      <!-- Advanced filter panel -->
      <div v-if="filtersOpen" class="mt-3 space-y-3 text-xs">
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

        <!-- Tags + skillsets + alt-version dropdown -->
        <details
          :open="tagsDropdownOpen"
          class="rounded border border-zinc-800 bg-zinc-900/40"
          @toggle="(e) => (tagsDropdownOpen = (e.target as HTMLDetailsElement).open)"
        >
          <summary class="cursor-pointer select-none flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-400 hover:text-zinc-100 transition-colors">
            <span>
              Tags
              <span v-if="tagsDropdownActiveCount" class="ml-1 normal-case tracking-normal text-accent">{{ tagsDropdownActiveCount }} selected</span>
            </span>
            <span class="text-zinc-600">{{ tagsDropdownOpen ? '▾' : '▸' }}</span>
          </summary>

          <div class="px-2 pb-2 pt-1 space-y-2.5">
            <div>
              <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Modifiers</div>
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
              <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Alternate versions</div>
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
              <p class="text-[10px] text-zinc-600 mt-1">"Alternate versions" are levels marked Same difficulty as above.</p>
            </div>
          </div>
        </details>

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
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Source</span>
          <select
            v-model="sourceFilter"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All sources</option>
            <option v-for="s in sources" :key="s.source" :value="s.source">
              {{ s.source }} ({{ s.count.toLocaleString() }})
            </option>
          </select>
        </label>

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

        <!-- Sort -->
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Sort by</span>
          <select
            v-model="sort"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option v-for="s in SORTS" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </label>

        <!-- Rank-by-filter toggle -->
        <label class="flex items-start gap-2 cursor-pointer select-none">
          <input v-model="rankByFilter" type="checkbox" class="mt-0.5 accent-accent" />
          <span>
            <span class="text-[11px] text-zinc-200">Rank by filter position</span>
            <span class="block text-[10px] text-zinc-500">
              Numbers reflect each level's place within the filtered list rather than the global list. Search narrows what's shown without changing ranks.
            </span>
          </span>
        </label>

        <div class="flex items-center justify-between pt-1">
          <button
            type="button"
            class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
            @click="resetFilters"
          >Reset filters</button>
          <span v-if="challengeMode" class="text-[10px] text-accent">Showing challenge ranks</span>
        </div>
      </div>
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
              #{{ lvl.displayRank ?? lvl.position }}
            </span>
            <span class="truncate">{{ lvl.name }}</span>
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

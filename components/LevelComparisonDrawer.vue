<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type ListLevel = { id?: number; position: number; name: string; gddl_tier: string | null; difficulty: string | null }

const props = defineProps<{
  open: boolean
  initial?: ListLevel | null
  // When true, picking a list item immediately emits `confirm` and closes —
  // skips the secondary "Confirm" button. Used by quick-action callers
  // (edit-form move-below, admin placement helper).
  confirmOnPick?: boolean
  title?: string
  hint?: string
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', v: ListLevel): void
}>()

const COMPARE_PAGE_SIZE = 500
const TIER_MAX_ORD = 44
const RATINGS = ['Challenge', 'Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'] as const

function ordToTier(ord: number): string {
  if (ord <= 5) return `Subtier ${ord}`
  return `Tier ${ord - 5}`
}

const compareMode = ref<'search' | 'browse'>('search')
const compareSearch = ref('')
const compareItems = ref<ListLevel[]>([])
const compareLoading = ref(false)
const comparePicked = ref<ListLevel | null>(null)
const compareTotal = ref(0)
const comparePageLow = ref(0)
const comparePageHigh = ref(0)
const compareInitialized = ref(false)

// --- Filters ---
const filtersOpen = ref(false)
const tierMin = ref(0)
const tierMax = ref(TIER_MAX_ORD)
const ratingSet = reactive<Record<string, boolean>>(
  Object.fromEntries(RATINGS.map((r) => [r, false])),
)
const activeCompareFilterCount = computed(() => {
  let n = 0
  if (tierMin.value > 0 || tierMax.value < TIER_MAX_ORD) n++
  if (RATINGS.some((r) => ratingSet[r])) n++
  return n
})
const compareTopDone = computed(() => compareInitialized.value && comparePageLow.value <= 1)
const compareBottomDone = computed(
  () => compareInitialized.value
    && comparePageHigh.value * COMPARE_PAGE_SIZE >= compareTotal.value,
)
const compareScrollEl = ref<HTMLElement | null>(null)
const compareTopSentinel = ref<HTMLElement | null>(null)
const compareBottomSentinel = ref<HTMLElement | null>(null)
let compareDebounce: ReturnType<typeof setTimeout> | null = null
let compareObserver: IntersectionObserver | null = null
let suppressSearchReload = false

function resetCompareList() {
  compareItems.value = []
  comparePageLow.value = 0
  comparePageHigh.value = 0
  compareTotal.value = 0
  compareInitialized.value = false
}

async function loadComparePage(page: number, where: 'append' | 'prepend') {
  if (compareLoading.value) return
  if (page < 1) return
  compareLoading.value = true
  try {
    const query: Record<string, any> = { page, pageSize: COMPARE_PAGE_SIZE }
    if (compareMode.value === 'search' && compareSearch.value) {
      query.search = compareSearch.value
    }
    if (tierMin.value > 0) query.tierMin = tierMin.value
    if (tierMax.value < TIER_MAX_ORD) query.tierMax = tierMax.value
    const selectedRatings = RATINGS.filter((r) => ratingSet[r])
    if (selectedRatings.length) query.ratings = selectedRatings.join(',')
    const res = await $fetch<{ total: number; items: ListLevel[] }>('/api/levels', { query })
    compareTotal.value = res.total
    if (where === 'append') {
      compareItems.value.push(...res.items)
      comparePageHigh.value = page
      if (comparePageLow.value === 0) comparePageLow.value = page
    } else {
      const el = compareScrollEl.value
      const prevHeight = el?.scrollHeight ?? 0
      const prevTop = el?.scrollTop ?? 0
      compareItems.value.unshift(...res.items)
      comparePageLow.value = page
      if (comparePageHigh.value === 0) comparePageHigh.value = page
      await nextTick()
      if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
    }
    compareInitialized.value = true
  } finally {
    compareLoading.value = false
  }
}

function loadCompareNext() {
  if (compareLoading.value) return
  if (comparePageHigh.value === 0) { loadComparePage(1, 'append'); return }
  if (compareBottomDone.value) return
  loadComparePage(comparePageHigh.value + 1, 'append')
}
function loadComparePrev() {
  if (compareLoading.value) return
  if (comparePageLow.value <= 1) return
  loadComparePage(comparePageLow.value - 1, 'prepend')
}

function scrollToPickedInList() {
  const lvl = comparePicked.value
  if (!lvl || !compareScrollEl.value) return
  const el = compareScrollEl.value.querySelector<HTMLElement>(`[data-pos="${lvl.position}"]`)
  el?.scrollIntoView({ block: 'center' })
}

async function pickCompareItem(lvl: ListLevel) {
  if (props.confirmOnPick) {
    comparePicked.value = lvl
    emit('confirm', lvl)
    emit('update:open', false)
    return
  }
  if (compareMode.value === 'browse') {
    comparePicked.value = lvl
    return
  }
  comparePicked.value = lvl
  compareMode.value = 'browse'
  if (compareDebounce) { clearTimeout(compareDebounce); compareDebounce = null }
  if (compareSearch.value !== '') {
    suppressSearchReload = true
    compareSearch.value = ''
  }
  resetCompareList()
  const targetPage = Math.max(1, Math.ceil(lvl.position / COMPARE_PAGE_SIZE))
  await loadComparePage(targetPage, 'append')
  await nextTick()
  scrollToPickedInList()
}

function backToSearch() {
  compareMode.value = 'search'
  resetCompareList()
  loadComparePage(1, 'append')
}

function close() { emit('update:open', false) }

watch(compareSearch, () => {
  if (compareDebounce) clearTimeout(compareDebounce)
  if (suppressSearchReload) { suppressSearchReload = false; return }
  compareDebounce = setTimeout(async () => {
    compareMode.value = 'search'
    resetCompareList()
    await loadComparePage(1, 'append')
  }, 200)
})

watch([tierMin, tierMax], () => {
  if (!compareInitialized.value) return
  resetCompareList()
  loadComparePage(1, 'append')
})
watch(ratingSet, () => {
  if (!compareInitialized.value) return
  resetCompareList()
  loadComparePage(1, 'append')
}, { deep: true })

watch(() => props.open, async (open) => {
  await nextTick()
  if (open) {
    comparePicked.value = props.initial ?? null
    compareMode.value = 'search'
    if (!compareInitialized.value) loadComparePage(1, 'append')
    if (compareScrollEl.value && !compareObserver) {
      compareObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue
            if (e.target === compareBottomSentinel.value) loadCompareNext()
            else if (e.target === compareTopSentinel.value) loadComparePrev()
          }
        },
        { root: compareScrollEl.value, rootMargin: '300px 0px' },
      )
      if (compareTopSentinel.value) compareObserver.observe(compareTopSentinel.value)
      if (compareBottomSentinel.value) compareObserver.observe(compareBottomSentinel.value)
    }
  } else {
    compareObserver?.disconnect()
    compareObserver = null
  }
})
onBeforeUnmount(() => compareObserver?.disconnect())

function confirm() {
  const lvl = comparePicked.value
  if (!lvl) return
  emit('confirm', lvl)
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex">
      <div class="absolute inset-0 bg-black/60" @click="close" />
      <aside class="relative flex flex-col w-full sm:w-[420px] h-full bg-zinc-950 border-r border-zinc-800 shadow-2xl">
        <header class="p-3 border-b border-zinc-800 flex items-center gap-2 shrink-0">
          <div class="flex flex-col">
            <span class="text-xs uppercase tracking-widest text-accent font-semibold">{{ title ?? 'Level comparison' }}</span>
            <span class="text-[11px] text-zinc-500">
              <template v-if="hint">{{ hint }}</template>
              <template v-else-if="confirmOnPick">Click a level to place this one right below it.</template>
              <template v-else-if="compareMode === 'search'">Search, then click a level to browse nearby placements.</template>
              <template v-else>Pick a level whose placement matches yours.</template>
            </span>
          </div>
          <button
            type="button"
            class="ml-auto text-zinc-500 hover:text-zinc-200 text-sm px-2 py-1"
            @click="close"
            aria-label="Close"
          >✕</button>
        </header>

        <div class="p-3 border-b border-zinc-800 shrink-0 flex items-center gap-2">
          <input
            v-model="compareSearch"
            type="search"
            placeholder="Search the main list…"
            class="flex-1 min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            class="shrink-0 px-2 py-1.5 rounded border text-xs font-medium transition-colors flex items-center gap-1"
            :class="filtersOpen || activeCompareFilterCount
              ? 'border-accent/60 text-accent bg-accent/10'
              : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'"
            :aria-expanded="filtersOpen"
            @click="filtersOpen = !filtersOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
              <path d="M3 4h18l-7 9v6l-4 2v-8z" />
            </svg>
            <span v-if="activeCompareFilterCount" class="tabular-nums">{{ activeCompareFilterCount }}</span>
          </button>
          <button
            v-if="compareMode === 'browse'"
            type="button"
            class="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-100 px-2 py-1.5 rounded border border-zinc-800 hover:border-zinc-700 transition-colors"
            @click="backToSearch"
          >Back to search</button>
        </div>

        <!-- Filter panel -->
        <div v-if="filtersOpen" class="p-3 border-b border-zinc-800 shrink-0 space-y-3 text-xs">
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
        </div>

        <div ref="compareScrollEl" class="flex-1 min-h-0 overflow-y-auto">
          <div ref="compareTopSentinel" class="px-3 py-2 text-[11px] text-zinc-600 text-center">
            <span v-if="compareLoading && comparePageLow > 1">loading…</span>
            <span v-else-if="compareItems.length && !compareTopDone">↑ scroll for more</span>
          </div>

          <ul v-if="compareItems.length" class="divide-y divide-zinc-900/60">
            <li v-for="lvl in compareItems" :key="lvl.position" :data-pos="lvl.position">
              <button
                type="button"
                class="w-full text-left flex items-center gap-2 pr-3 py-1.5 text-sm transition-colors"
                :style="comparePicked?.position === lvl.position
                  ? { backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }
                  : undefined"
                :class="comparePicked?.position === lvl.position ? '' : 'text-zinc-300 hover:bg-zinc-900/70'"
                @click="pickCompareItem(lvl)"
              >
                <span
                  class="text-[11px] tabular-nums px-2 py-1 w-14 shrink-0 text-center font-medium"
                  :style="{ backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }"
                >#{{ lvl.position }}</span>
                <span class="truncate flex-1">{{ lvl.name }}</span>
                <span v-if="lvl.gddl_tier" class="text-[10px] opacity-70 shrink-0">{{ lvl.gddl_tier }}</span>
              </button>
            </li>
          </ul>
          <div v-else-if="compareLoading" class="px-3 py-6 text-xs text-zinc-500 text-center">loading…</div>
          <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">No matches.</div>

          <div ref="compareBottomSentinel" class="px-3 py-3 text-[11px] text-zinc-600 text-center">
            <span v-if="compareLoading && compareItems.length">loading…</span>
            <span v-else-if="compareBottomDone && compareItems.length > 0">{{ compareTotal.toLocaleString() }} levels — end of list</span>
            <span v-else-if="compareItems.length">↓ scroll for more</span>
          </div>
        </div>

        <footer class="p-3 border-t border-zinc-800 shrink-0 flex items-center gap-2">
          <div class="text-[11px] text-zinc-400 truncate flex-1">
            <template v-if="comparePicked">
              Selected: <span class="text-zinc-100 font-medium">#{{ comparePicked.position }} {{ comparePicked.name }}</span>
            </template>
            <template v-else>
              <span class="text-zinc-600">No level selected.</span>
            </template>
          </div>
          <button
            type="button"
            class="rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 text-xs px-2.5 py-1.5 transition-colors"
            @click="close"
          >Cancel</button>
          <button
            v-if="!confirmOnPick"
            type="button"
            :disabled="!comparePicked"
            class="rounded bg-accent text-zinc-950 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium px-2.5 py-1.5 transition-colors"
            @click="confirm"
          >Confirm</button>
        </footer>
      </aside>
    </div>
  </Teleport>
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

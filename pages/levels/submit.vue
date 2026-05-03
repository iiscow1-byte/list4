<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Submit a level — All Levels List' })

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const isAdmin = computed(() => {
  const r = me.value?.role
  return r === 'admin' || r === 'owner' || r === 'developer'
})

const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: 39 }, (_, i) => `Tier ${i + 1}`),
]
const DIFFICULTY_OPTIONS = [
  '', 'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
]
const SKILLSET_OPTIONS = [
  '', 'Wave', 'Memory', 'Timings', 'Ship', 'Solo 2P', 'Controlled Spam', 'Flow',
  'Nerve Control', 'Chokepoints', 'High CPS', 'Overall', 'Learny', 'Duals', 'Fast Paced',
  'Consistency', 'Swingcopter', 'Robot', 'Endurance', 'Cube', 'Straight Fly', 'UFO',
  'Ship Control', 'Ball', 'Spider', 'Spam', 'Framelocked',
]
const ALL_TAGS = ['old', 'uldm', 'buffed', 'nerfed'] as const

const gdId = ref('')
const name = ref('')
const fps = ref('any')
const gameVersion = ref('any')
const verification = ref('')
const verificationUrl = ref('')
const verifier = ref('')
const verifyDate = ref('')
const placementSource = ref<string>('')

// Existing curated source list (Demon List, Pemonlist, GDDP, …) so submitters
// can pick where they originally found the level. "" = the default "None"
// option, which the server stores as "All Levels List".
const { data: sourcesRes } = await useFetch<{ sources: { source: string; count: number }[] }>(
  '/api/levels/sources',
  { default: () => ({ sources: [] }) },
)
const sourceOptions = computed(() =>
  (sourcesRes.value?.sources ?? [])
    .map((s) => s.source)
    .filter((s) => s && s.toLowerCase() !== 'all levels list'),
)
const gddlTier = ref('')
const difficulty = ref('')
const enjoyment = ref('')
const skillset = ref('')
const tagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })
const notes = ref('')
const placementEstimate = ref<string>('')
const comparisonLevel = ref<{ position: number; name: string; gddl_tier: string | null; difficulty: string | null } | null>(null)

const submitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

// --- Level comparison drawer ---
type ListLevel = { position: number; name: string; gddl_tier: string | null; difficulty: string | null }
const COMPARE_PAGE_SIZE = 500
const compareOpen = ref(false)
const compareMode = ref<'search' | 'browse'>('search')
const compareSearch = ref('')
const compareItems = ref<ListLevel[]>([])
const compareLoading = ref(false)
const comparePicked = ref<ListLevel | null>(null)
const compareTotal = ref(0)
// Loaded page window. 0 = none loaded yet.
const comparePageLow = ref(0)
const comparePageHigh = ref(0)
const compareInitialized = ref(false)
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
    const res = await $fetch<{ total: number; items: ListLevel[] }>('/api/levels', { query })
    compareTotal.value = res.total
    if (where === 'append') {
      compareItems.value.push(...res.items)
      comparePageHigh.value = page
      if (comparePageLow.value === 0) comparePageLow.value = page
    } else {
      // Prepend: preserve visual scroll position by compensating for added height.
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
  if (compareMode.value === 'browse') {
    comparePicked.value = lvl
    return
  }
  // From search mode: switch to browse view of the full list, centered on this level.
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

function openCompare() {
  compareOpen.value = true
  comparePicked.value = comparisonLevel.value
  compareMode.value = 'search'
  if (!compareInitialized.value) loadComparePage(1, 'append')
}
function closeCompare() {
  compareOpen.value = false
}
watch(compareSearch, () => {
  if (compareDebounce) clearTimeout(compareDebounce)
  if (suppressSearchReload) { suppressSearchReload = false; return }
  compareDebounce = setTimeout(async () => {
    compareMode.value = 'search'
    resetCompareList()
    await loadComparePage(1, 'append')
  }, 200)
})
watch(compareOpen, async (open) => {
  await nextTick()
  if (open) {
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

function confirmCompare() {
  const lvl = comparePicked.value
  if (!lvl) return
  comparisonLevel.value = lvl
  if (lvl.gddl_tier) gddlTier.value = lvl.gddl_tier
  if (lvl.difficulty) difficulty.value = lvl.difficulty
  placementEstimate.value = String(lvl.position)
  compareOpen.value = false
}
function clearComparison() {
  comparisonLevel.value = null
  placementEstimate.value = ''
}

// Derive whether the level "looks like" something that needs a verification video.
function tierNumber(label: string): number | null {
  const m = label.match(/^Tier (\d{1,2})$/)
  return m ? Number(m[1]) : null
}
const looksHard = computed(() => {
  if (difficulty.value === 'Extreme Demon') return true
  const n = tierNumber(gddlTier.value)
  return n != null && n >= 20
})
const hasVerificationInfo = computed(() =>
  !!(verification.value.trim() || verificationUrl.value.trim() || verifier.value.trim() || verifyDate.value.trim()),
)
const verificationWarning = computed(() =>
  looksHard.value && !hasVerificationInfo.value
    ? 'Extreme Demons / Tier 20+ levels usually need a verification video.'
    : null,
)
const noOpinion = computed(() => !gddlTier.value && !difficulty.value)

function youtubeId(url: string | null): string | null {
  if (!url) return null
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]!
  }
  return null
}
const ytId = computed(() => youtubeId(verificationUrl.value.trim()))

async function submit() {
  if (submitting.value) return
  error.value = null
  if (!gdId.value.trim() || !/^\d+$/.test(gdId.value.trim())) {
    error.value = 'A numeric level ID is required.'
    return
  }
  if (!isAdmin.value && !verificationUrl.value.trim()) {
    error.value = 'A verification video link is required.'
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/levels/submit', {
      method: 'POST',
      body: {
        gd_id: gdId.value.trim(),
        name: name.value.trim() || null,
        fps: fps.value.trim() || 'any',
        game_version: gameVersion.value.trim() || 'any',
        verification: verification.value.trim() || null,
        verification_url: verificationUrl.value.trim() || null,
        verifier: verifier.value.trim() || null,
        verify_date: verifyDate.value || null,
        placement_source: placementSource.value || null,
        gddl_tier: gddlTier.value || null,
        difficulty: difficulty.value || null,
        enjoyment: enjoyment.value !== '' ? Number(enjoyment.value) : null,
        main_skillset: skillset.value || null,
        tags: ALL_TAGS.filter((t) => tagSet[t]),
        notes: notes.value.trim() || null,
        placement_estimate: placementEstimate.value !== '' ? Number(placementEstimate.value) : null,
        comparison_level_id: comparisonLevel.value?.position ?? null,
        comparison_level_name: comparisonLevel.value?.name ?? null,
      },
    })
    success.value = true
    // Reset form (but keep fps/version defaults)
    gdId.value = ''; name.value = ''; verification.value = ''; verificationUrl.value = ''
    verifier.value = ''; verifyDate.value = ''; placementSource.value = ''
    gddlTier.value = ''; difficulty.value = ''
    enjoyment.value = ''; skillset.value = ''; notes.value = ''
    placementEstimate.value = ''; comparisonLevel.value = null
    for (const t of ALL_TAGS) tagSet[t] = false
    setTimeout(() => (success.value = false), 6000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-2xl">
    <h1 class="text-3xl font-semibold tracking-tight mb-1">Submit a level</h1>
    <p class="text-sm text-zinc-400 mb-6">
      Suggest a new level for the list. A moderator reviews each submission and picks its placement.
    </p>

    <form class="space-y-5" @submit.prevent="submit">
      <!-- Level ID + name -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="block sm:col-span-1">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID <span class="text-red-400">*</span></span>
          <input
            v-model="gdId"
            inputmode="numeric"
            placeholder="e.g. 12345678"
            required
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name <span class="text-zinc-600 normal-case">— optional, mods will fill from GD</span></span>
          <input
            v-model="name"
            placeholder="Level name"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>

      <!-- Source -->
      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">
          Source
          <span class="text-zinc-600 normal-case">— where you found this level. Leave on "None" if it's first-party to the All Levels List.</span>
        </span>
        <select
          v-model="placementSource"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">None</option>
          <option v-for="s in sourceOptions" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <!-- FPS + Version -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">FPS</span>
          <input
            v-model="fps"
            placeholder="any"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Game version</span>
          <input
            v-model="gameVersion"
            placeholder="any"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>

      <!-- Verification -->
      <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verification</legend>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">
            Verification link <span v-if="!isAdmin" class="text-red-400">*</span>
            <span v-if="isAdmin" class="text-zinc-600 normal-case">— optional for admins</span>
          </span>
          <input
            v-model="verificationUrl"
            type="url"
            :required="!isAdmin"
            placeholder="https://www.youtube.com/watch?v=…"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <div v-if="ytId" class="aspect-video rounded-md border border-zinc-800 bg-black overflow-hidden">
          <iframe
            :src="`https://www.youtube.com/embed/${ytId}`"
            class="w-full h-full"
            title="Verification preview"
            frameborder="0"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verifier</span>
            <input
              v-model="verifier"
              placeholder="Player name"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification date</span>
            <input
              v-model="verifyDate"
              type="date"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        </div>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification title <span class="text-zinc-600 normal-case">— optional</span></span>
          <input
            v-model="verification"
            placeholder='e.g. "Level Name 100% Verified"'
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <p
          v-if="verificationWarning"
          class="text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded px-3 py-2"
        >⚠ {{ verificationWarning }}</p>
      </fieldset>

      <!-- Difficulty opinion -->
      <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty opinion <span class="text-zinc-600 normal-case">— optional</span></legend>

        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-zinc-500">
            Not sure where it fits? Compare against an existing level to autofill the tier, demon level, and a placement estimate.
          </span>
          <button
            type="button"
            class="shrink-0 rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
            @click="openCompare"
          >Level comparison</button>
        </div>

        <div
          v-if="comparisonLevel"
          class="rounded border border-accent/40 bg-accent/5 px-3 py-2 text-xs flex items-center gap-2"
        >
          <span class="text-zinc-400">Compared to</span>
          <span class="text-zinc-100 font-medium truncate">#{{ comparisonLevel.position }} {{ comparisonLevel.name }}</span>
          <span v-if="comparisonLevel.gddl_tier" class="text-zinc-500">· {{ comparisonLevel.gddl_tier }}</span>
          <span v-if="comparisonLevel.difficulty" class="text-zinc-500">· {{ comparisonLevel.difficulty }}</span>
          <button type="button" class="ml-auto text-zinc-500 hover:text-red-400" @click="clearComparison">clear</button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
            <select
              v-model="gddlTier"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option v-for="t in TIER_OPTIONS" :key="t" :value="t">{{ t || '— none —' }}</option>
            </select>
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Demon level</span>
            <select
              v-model="difficulty"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option v-for="d in DIFFICULTY_OPTIONS" :key="d" :value="d">{{ d || '— none —' }}</option>
            </select>
          </label>
        </div>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Placement estimation <span class="text-zinc-600 normal-case">— optional, mods can change it</span></span>
          <input
            v-model="placementEstimate"
            type="number" inputmode="numeric" min="1"
            placeholder="e.g. 42"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <p
          v-if="noOpinion"
          class="text-xs text-fuchsia-300 bg-fuchsia-950/30 border border-fuchsia-900/50 rounded px-3 py-2"
        >⚠ Levels submitted without a difficulty opinion will be added to the voided list and will not be placed yet.</p>
      </fieldset>

      <!-- Optional metadata -->
      <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Extra info <span class="text-zinc-600 normal-case">— optional</span></legend>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">0–10</span></span>
            <input
              v-model="enjoyment"
              type="number"
              min="0"
              max="10"
              step="0.1"
              inputmode="decimal"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
            <select
              v-model="skillset"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option v-for="s in SKILLSET_OPTIONS" :key="s" :value="s">{{ s || '— none —' }}</option>
            </select>
          </label>
        </div>

        <div>
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Tags</span>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <label
              v-for="t in ALL_TAGS" :key="t"
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
      </fieldset>

      <!-- Notes -->
      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Notes for the mods <span class="text-zinc-600 normal-case">— optional</span></span>
        <textarea
          v-model="notes"
          rows="4"
          maxlength="4000"
          placeholder="Anything the moderator should know — context, comparisons, sources…"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="submitting"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >{{ submitting ? 'Submitting…' : 'Submit for review' }}</button>
        <span v-if="success" class="text-xs text-emerald-400">Submitted — pending review.</span>
        <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
      </div>
    </form>

    <!-- Level comparison drawer -->
    <Teleport to="body">
      <div v-if="compareOpen" class="fixed inset-0 z-50 flex">
        <div class="absolute inset-0 bg-black/60" @click="closeCompare" />
        <aside class="relative flex flex-col w-full sm:w-[420px] h-full bg-zinc-950 border-r border-zinc-800 shadow-2xl">
          <header class="p-3 border-b border-zinc-800 flex items-center gap-2 shrink-0">
            <div class="flex flex-col">
              <span class="text-xs uppercase tracking-widest text-accent font-semibold">Level comparison</span>
              <span class="text-[11px] text-zinc-500">
                <template v-if="compareMode === 'search'">Search, then click a level to browse nearby placements.</template>
                <template v-else>Pick a level whose tier and rank match yours.</template>
              </span>
            </div>
            <button
              type="button"
              class="ml-auto text-zinc-500 hover:text-zinc-200 text-sm px-2 py-1"
              @click="closeCompare"
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
              v-if="compareMode === 'browse'"
              type="button"
              class="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-100 px-2 py-1.5 rounded border border-zinc-800 hover:border-zinc-700 transition-colors"
              @click="backToSearch"
            >Back to search</button>
          </div>

          <div ref="compareScrollEl" class="flex-1 min-h-0 overflow-y-auto">
            <div
              ref="compareTopSentinel"
              class="px-3 py-2 text-[11px] text-zinc-600 text-center"
            >
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
                  >
                    #{{ lvl.position }}
                  </span>
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
              @click="closeCompare"
            >Cancel</button>
            <button
              type="button"
              :disabled="!comparePicked"
              class="rounded bg-accent text-zinc-950 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium px-2.5 py-1.5 transition-colors"
              @click="confirmCompare"
            >Confirm</button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

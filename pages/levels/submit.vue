<script setup lang="ts">
import { challengeCompareFilter, compareTargetPage } from '~/utils/challenge-compare'
import { gdLevelUrl } from '~/utils/gd-links'
import { TIER_MAX_NUMBER } from '~/utils/tier-ordinal'
import { tierColor, textOn } from '~/utils/tier-colors'
import { parseTierShortcut } from '~/utils/tier-shortcut'

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
  ...Array.from({ length: TIER_MAX_NUMBER }, (_, i) => `Tier ${i + 1}`),
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
const ALL_TAGS = ['old', 'uldm', 'buffed', 'nerfed', 'unnerfed', 'easy', 'shitty'] as const

const RATING_OPTIONS = ['', 'Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'] as const

// Prefilled when arriving from /levels/find (a level picked out of the GD
// search) or from a custom list's "Submit to the ALL" button, so the level
// lands here with everything the other page already knew about it.
const submitRoute = useRoute()

/** Read one query param as a trimmed, length-capped string. */
function q(key: string, max = 200): string {
  const v = submitRoute.query[key]
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

const gdId = ref(/^\d+$/.test(q('gd_id')) ? q('gd_id') : '')
const name = ref(q('name'))
const verification = ref('')
const verificationUrl = ref(/^https?:\/\//i.test(q('verification_url', 500)) ? q('verification_url', 500) : '')
const verifier = ref(q('verifier'))
const verifyDate = ref('')
const placementSource = ref<string>(q('placement_source', 60))
const ratingOpinion = ref('')

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
// Only accept a prefilled tier / difficulty the form actually offers, so a
// stale or hand-edited link can't seed a value the select can't display.
const gddlTier = ref(TIER_OPTIONS.includes(q('gddl_tier', 40)) ? q('gddl_tier', 40) : '')
const difficulty = ref(DIFFICULTY_OPTIONS.includes(q('difficulty', 40)) ? q('difficulty', 40) : '')
const enjoyment = ref('')
const skillset = ref('')
const tagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false, unnerfed: false, easy: false, shitty: false })
const notes = ref('')
// A custom list's "Submit to the ALL" button already worked out where the level
// would sit from its neighbours and passes it here; the form used to drop it on
// the floor and make the submitter guess a number out of 54,000 again.
const placementEstimate = ref<string>(/^\d{1,7}$/.test(q('placement_estimate', 8)) ? q('placement_estimate', 8) : '')
const comparisonLevel = ref<{ position: number; name: string; gddl_tier: string | null; difficulty: string | null; challenge_rank?: number | null } | null>(null)
const sameAsAbove = ref(false)
const isAlternate = ref(false)
const isChallenge = ref(false)

const ABOVE_EASY_DEMON = new Set(['Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon'])
const showChallenge = computed(() => ABOVE_EASY_DEMON.has(difficulty.value))
watch(difficulty, (d) => { if (!ABOVE_EASY_DEMON.has(d)) isChallenge.value = false })
// Optional original-level pointers for the Duplicate / Alternate tags. Stored
// as the levels.id on the server so the link survives reorders.
type OriginalLevel = { id?: number; position: number; name: string }
const duplicateOfLevel = ref<OriginalLevel | null>(null)
const alternateOfLevel = ref<OriginalLevel | null>(null)
const duplicateOfPickerOpen = ref(false)
const alternateOfPickerOpen = ref(false)

const submitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

// --- Level comparison drawer ---
type ListLevel = {
  id?: number; position: number; name: string
  gddl_tier: string | null; difficulty: string | null
  /** 1-based rank among challenges only, when this level is one. */
  challenge_rank?: number | null
}
const COMPARE_PAGE_SIZE = 500
const compareOpen = ref(false)
const compareMode = ref<'search' | 'browse'>('search')
const compareSearch = ref('')
const compareExternalList = ref('')      // '' | 'aredl' | 'gdl'
const compareRatingFilter = ref('')     // '' | 'Unrated' | 'Rated' | 'Challenge'
/**
 * The comparison drawer follows the Challenge checkbox.
 *
 * A challenge and a level of the same tier are not comparable things — one is
 * under thirty seconds and the other is not — so somebody who has just said
 * "this is a challenge" and then opens Compare is looking for other challenges.
 * They were shown the whole 54,000-level list and had to know to find the rating
 * dropdown, which is three clicks away from the checkbox they just ticked.
 *
 * The dropdown is still there and still wins if it is changed by hand; ticking
 * the box again re-asserts challenge mode.
 */
const compareChallengeMode = computed(() => compareRatingFilter.value === 'Challenge')
/** What the loaded page window was fetched with, so a stale window is reloaded. */
let compareLoadedKey = ''
const compareKey = computed(() => `${compareExternalList.value}|${compareRatingFilter.value}`)
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
let suppressFilterReload = false
let lastCompareTierLookup = ''
let lastComparePositionLookup = 0
let lastCompareGdIdLookup = ''

async function jumpCompareToPosition(pos: number) {
  if (compareDebounce) { clearTimeout(compareDebounce); compareDebounce = null }
  suppressSearchReload = true
  compareSearch.value = ''
  compareMode.value = 'browse'
  resetCompareList()
  // No challenge rank to go on — a shortcut only ever resolves a list position
  // — so in challenge mode this starts at the top. See `compareTargetPage`.
  const targetPage = compareTargetPage(
    { challengeMode: compareChallengeMode.value, position: pos, challengeRank: null },
    COMPARE_PAGE_SIZE,
  )
  await loadComparePage(targetPage, 'append')
  await nextTick()
  compareScrollEl.value?.querySelector<HTMLElement>(`[data-pos="${pos}"]`)
    ?.scrollIntoView({ block: 'center' })
}

async function maybeJumpCompareToTier(): Promise<boolean> {
  const result = parseTierShortcut(compareSearch.value)
  if (!result) return false
  const key = `${result.tier}|${result.frac}`
  if (key === lastCompareTierLookup) return false
  lastCompareTierLookup = key
  try {
    const res = await $fetch<{ tier: string; count: number; midpoint: number | null }>(
      '/api/levels/tier-midpoint', { query: { tier: result.tier, frac: 1 - result.frac } },
    )
    if (res?.midpoint) {
      lastCompareTierLookup = ''
      await jumpCompareToPosition(res.midpoint)
      return true
    }
  } catch { /* non-fatal */ }
  lastCompareTierLookup = ''
  return false
}

async function maybeJumpCompareToPosition(): Promise<boolean> {
  const q = compareSearch.value.trim()
  const m = q.match(/^#(\d+)$/)
  if (!m) return false
  const pos = Number(m[1])
  if (!Number.isInteger(pos) || pos <= 0) return false
  if (pos === lastComparePositionLookup) return false
  lastComparePositionLookup = pos
  await jumpCompareToPosition(pos)
  lastComparePositionLookup = 0
  return true
}

async function maybeJumpCompareToGdId(): Promise<boolean> {
  const q = compareSearch.value.trim()
  if (!/^\d+$/.test(q)) return false
  const n = Number(q)
  if (!Number.isInteger(n) || n <= 0) return false
  if (q === lastCompareGdIdLookup) return false
  lastCompareGdIdLookup = q
  try {
    const res = await $fetch<{ position: number; name: string }>(`/api/levels/by-gd-id/${n}`)
    if (res?.position) {
      lastCompareGdIdLookup = ''
      await jumpCompareToPosition(res.position)
      return true
    }
  } catch { /* non-fatal */ }
  lastCompareGdIdLookup = ''
  return false
}

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
    if (compareExternalList.value) query.externalList = compareExternalList.value
    if (compareRatingFilter.value) query.ratings = compareRatingFilter.value
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
    compareLoadedKey = compareKey.value
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
  comparePicked.value = lvl
  if (compareMode.value === 'browse') return

  // Clicking a level always opens the full unfiltered list in browse mode
  // centered on that level, so the user can see it in context.
  compareMode.value = 'browse'
  if (compareDebounce) { clearTimeout(compareDebounce); compareDebounce = null }

  // Clear the filters without triggering the filter watcher's reload — except
  // the challenge one, which is the shape of the list being browsed rather than
  // a filter on it. Dropping it here put a challenge back in the middle of
  // 54,000 levels, which is precisely the context that isn't wanted.
  suppressFilterReload = true
  compareExternalList.value = ''
  if (!compareChallengeMode.value) compareRatingFilter.value = ''
  if (compareSearch.value !== '') {
    suppressSearchReload = true
    compareSearch.value = ''
  }

  resetCompareList()
  const targetPage = compareTargetPage(
    { challengeMode: compareChallengeMode.value, position: lvl.position, challengeRank: lvl.challenge_rank },
    COMPARE_PAGE_SIZE,
  )
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
  // The checkbox may have been ticked while this was closed, in which case the
  // filter watcher deliberately did nothing — it only reloads a visible list.
  // So the drawer checks on the way in whether what is loaded still matches.
  suppressFilterReload = true
  compareRatingFilter.value = isChallenge.value
    ? challengeCompareFilter(true, compareRatingFilter.value)
    : compareRatingFilter.value
  if (!compareInitialized.value || compareLoadedKey !== compareKey.value) {
    resetCompareList()
    loadComparePage(1, 'append')
  }
}
function closeCompare() {
  compareOpen.value = false
}
watch(compareSearch, () => {
  if (compareDebounce) clearTimeout(compareDebounce)
  if (suppressSearchReload) { suppressSearchReload = false; return }
  compareDebounce = setTimeout(async () => {
    if (await maybeJumpCompareToTier()) return
    if (await maybeJumpCompareToPosition()) return
    if (await maybeJumpCompareToGdId()) return
    compareMode.value = 'search'
    resetCompareList()
    await loadComparePage(1, 'append')
  }, 200)
})
watch([compareExternalList, compareRatingFilter], () => {
  if (!compareOpen.value || suppressFilterReload) { suppressFilterReload = false; return }
  compareMode.value = 'search'
  resetCompareList()
  loadComparePage(1, 'append')
})

// Ticking Challenge puts the drawer in challenge mode; unticking takes it out.
// The rule itself is `utils/challenge-compare.ts`, where it can be checked.
watch(isChallenge, (on) => {
  compareRatingFilter.value = challengeCompareFilter(on, compareRatingFilter.value)
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
  // A challenge picked as the comparison says this one is a challenge too —
  // the checkbox is the thing that decides where the level is ranked, so it
  // follows the pick rather than needing to be remembered separately.
  if (lvl.challenge_rank != null && showChallenge.value) isChallenge.value = true
  if (lvl.gddl_tier) gddlTier.value = lvl.gddl_tier
  if (lvl.difficulty) difficulty.value = lvl.difficulty
  placementEstimate.value = String(lvl.position)
  // A picked comparison is a stronger statement than "middle of the tier", so
  // the tier watcher must not treat this number as its own to overwrite.
  autofilledPlacement = null
  tierPlacementNote.value = null
  compareOpen.value = false
}
function clearComparison() {
  comparisonLevel.value = null
  placementEstimate.value = ''
  autofilledPlacement = null
  // Dropping the comparison leaves the tier as the only thing said about
  // difficulty, so it gets the box back.
  applyTierMidpoint(gddlTier.value)
}

/**
 * A tier is already an answer to "where does this go".
 *
 * Every tier occupies a contiguous stretch of the list, so naming one narrows
 * 54,000 slots down to a few hundred — and the middle of that stretch is a far
 * better starting point than the blank box submitters were left staring at.
 * The number stays editable; this fills it in, it doesn't decide it.
 *
 * Only ever writes into an empty box or one it filled itself, so a typed
 * placement, a prefill from a custom list, and a picked comparison level all
 * survive changing the tier afterwards.
 */
const tierPlacementNote = ref<string | null>(null)
/** Exactly what the last autofill wrote, which is how "mine to overwrite" is decided. */
let autofilledPlacement: string | null = null

async function applyTierMidpoint(tier: string) {
  const mine = placementEstimate.value === '' || placementEstimate.value === autofilledPlacement
  if (!mine) return

  if (!tier) {
    if (placementEstimate.value === autofilledPlacement) placementEstimate.value = ''
    autofilledPlacement = null
    tierPlacementNote.value = null
    return
  }

  try {
    const res = await $fetch<{ tier: string; count: number; midpoint: number | null }>(
      '/api/levels/tier-midpoint', { query: { tier } },
    )
    // The tier may have been changed again while this was in flight, and the
    // box may have been typed into. Re-check both before writing.
    if (gddlTier.value !== tier) return
    if (placementEstimate.value !== '' && placementEstimate.value !== autofilledPlacement) return

    if (res.midpoint == null) {
      tierPlacementNote.value = `The ALL has no ${tier} levels yet, so there's no middle of it to point at.`
      return
    }
    autofilledPlacement = String(res.midpoint)
    placementEstimate.value = autofilledPlacement
    tierPlacementNote.value =
      `Middle of ${tier} — ${res.count.toLocaleString()} level${res.count === 1 ? '' : 's'} on the ALL. Change it if you know better.`
  } catch {
    tierPlacementNote.value = null
  }
}

watch(gddlTier, (tier) => { applyTierMidpoint(tier) })
// Typing over the suggestion retires the note with it.
watch(placementEstimate, (v) => {
  if (v !== autofilledPlacement) tierPlacementNote.value = null
})
// A tier arriving in the URL (from a custom list's "Submit to the ALL") gets
// the same treatment, unless that link already carried a placement.
onMounted(() => { if (gddlTier.value) applyTierMidpoint(gddlTier.value) })

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
const noOpinion = computed(() => !gddlTier.value)

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

const dateLoading = ref(false)
// `immediate` matters: arriving from a custom list or from /levels/find brings
// the video link in the query string, so `ytId` already has its final value by
// the time the watcher is registered and would otherwise never fire — which is
// why prefilled submissions turned up with an empty verification date.
watch(ytId, async (id) => {
  // Client-only: a server render firing this would spend a YouTube quota unit
  // on a result the browser is about to fetch again anyway.
  if (!id || !import.meta.client) return
  if (verifyDate.value) return
  dateLoading.value = true
  try {
    const res = await $fetch<{ date: string | null }>(`/api/youtube/upload-date?id=${id}`)
    if (res?.date && !verifyDate.value) verifyDate.value = res.date
  } catch { /* ignore — user can fill in the date manually */ } finally {
    dateLoading.value = false
  }
}, { immediate: true })

/**
 * What the form still needs, in the order `submit()` checks it.
 *
 * Derived from the same conditions rather than restated, so the checklist and
 * the validation can't drift apart. Shown live so a missing verifier is
 * visible before pressing Submit rather than as a one-line error after.
 */
const requirements = computed(() => [
  { label: 'Level ID',          ok: /^\d+$/.test(gdId.value.trim()), field: 'gd_id' },
  { label: 'Level name',        ok: !!name.value.trim(),              field: 'name' },
  { label: 'Verifier',          ok: !!verifier.value.trim(),          field: 'verifier' },
  { label: 'Verification date', ok: !!verifyDate.value,               field: 'verify_date' },
  { label: 'Verification link', ok: isAdmin.value || !!verificationUrl.value.trim(), field: 'verification_url' },
])
const missing = computed(() => requirements.value.filter((r) => !r.ok))
const missingCount = computed(() => missing.value.length)
/** Named in the submit bar, so "still empty" says which one and jumps to it. */
const firstMissing = computed(() => missing.value[0] ?? null)
/** Whether the verification section has everything it needs, for its summary. */
const verificationDone = computed(
  () => !!verifier.value.trim() && !!verifyDate.value && (isAdmin.value || !!verificationUrl.value.trim()),
)

/**
 * Jump to the field a requirement chip names.
 *
 * The chips told you what was missing and left you to find it — and three of
 * the five live inside collapsed sections, so "Verifier" could be pointing at
 * something not on screen. Opening the section first is the whole point.
 */
function focusField(field: string) {
  const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`)
  if (!el) return
  el.closest('details')?.setAttribute('open', '')
  nextTick(() => {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus({ preventScroll: true })
  })
}

/**
 * The level's own art, once there's an ID to look it up with.
 *
 * Submitting the wrong level is the easiest mistake to make on this form and
 * the hardest to notice afterwards — an ID is eight digits with no meaning. If
 * the thumbnail is the level you meant, it's the right ID.
 */
const previewGdId = computed(() => {
  const raw = gdId.value.trim()
  return /^\d{1,12}$/.test(raw) ? Number(raw) : null
})

async function submit() {
  if (submitting.value) return
  error.value = null
  if (!gdId.value.trim() || !/^\d+$/.test(gdId.value.trim())) {
    error.value = 'A numeric level ID is required.'
    return
  }
  if (!name.value.trim()) {
    error.value = 'Level name is required.'
    return
  }
  if (!verifier.value.trim()) {
    error.value = 'Verifier is required.'
    return
  }
  if (!verifyDate.value) {
    error.value = 'Verification date is required.'
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
        same_as_above: sameAsAbove.value,
        duplicate_of_id: sameAsAbove.value ? duplicateOfLevel.value?.id ?? null : null,
        is_alternate: isAlternate.value,
        alternate_of_id: isAlternate.value ? alternateOfLevel.value?.id ?? null : null,
        is_challenge: isChallenge.value,
        rating: ratingOpinion.value || null,
      },
    })
    success.value = true
    gdId.value = ''; name.value = ''; verification.value = ''; verificationUrl.value = ''
    verifier.value = ''; verifyDate.value = ''; placementSource.value = ''
    gddlTier.value = ''; difficulty.value = ''
    enjoyment.value = ''; ratingOpinion.value = ''; skillset.value = ''; notes.value = ''
    placementEstimate.value = ''; comparisonLevel.value = null
    sameAsAbove.value = false
    isAlternate.value = false
    isChallenge.value = false
    duplicateOfLevel.value = null
    alternateOfLevel.value = null
    for (const t of ALL_TAGS) tagSet[t] = false
    setTimeout(() => (success.value = false), 6000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}

/**
 * One definition of what a field on this form looks like.
 *
 * Every input carried its own copy of the same seventy characters of Tailwind,
 * and they had already drifted: three different corner radii and two paddings
 * across a form of fourteen boxes.
 */
const field = 'mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'text-[11px] uppercase tracking-widest text-zinc-500'
const hint = 'text-zinc-600 normal-case tracking-normal'
/** Shared chrome for the form's sections, collapsible or not. */
const card = 'card'
const sectionHead = 'px-4 py-3 flex items-center gap-2'
</script>

<template>
  <div class="container-tight py-8 max-w-2xl">
    <header class="mb-6">
      <h1 class="text-3xl font-bold tracking-tight">Submit a level</h1>
      <p class="text-sm text-zinc-400 mt-1 max-w-prose">
        Anything the All Levels List doesn't have yet. A moderator reads every submission
        and decides where it goes — the more you can say about the difficulty, the closer
        that placement starts.
      </p>

      <!-- Live requirements, so "what's missing" is answerable without pressing
           Submit and reading a single-line error. Each one jumps to its field,
           opening the section around it on the way. -->
      <ul class="mt-4 flex flex-wrap items-center gap-1.5">
        <li class="text-[11px] text-zinc-600 mr-0.5">Required:</li>
        <li v-for="r in requirements" :key="r.label">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            :class="r.ok
              ? 'border-emerald-900/60 bg-emerald-950/25 text-emerald-300'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-amber-800/70 hover:text-amber-300'"
            :title="r.ok ? `${r.label} — done` : `Go to ${r.label}`"
            @click="focusField(r.field)"
          >
            <span class="text-[10px]" aria-hidden="true">{{ r.ok ? '✓' : '○' }}</span>
            {{ r.label }}
          </button>
        </li>
      </ul>
    </header>

    <form class="space-y-4" @submit.prevent="submit">
      <!-- The level itself. Not collapsible: it's the two fields the form
           can't do without, and a section you must open to fill in is a
           section that gets left closed. -->
      <section :class="card">
        <div :class="sectionHead">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">The level</h2>
          <span class="ml-auto text-[10px] text-zinc-600">Both required</span>
        </div>
        <div class="px-4 pb-4 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="block sm:col-span-1">
              <span :class="label">Level ID <span class="text-red-400">*</span></span>
              <input
                v-model="gdId"
                data-field="gd_id"
                inputmode="numeric"
                placeholder="e.g. 12345678"
                required
                :class="field"
              />
            </label>
            <label class="block sm:col-span-2">
              <span :class="label">Level name <span class="text-red-400">*</span></span>
              <input
                v-model="name"
                data-field="name"
                placeholder="Level name"
                required
                :class="field"
              />
            </label>
          </div>

          <!-- Is this the level you meant? An eight-digit ID isn't checkable by
               eye; its thumbnail is. -->
          <div
            v-if="previewGdId"
            class="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
          >
            <LevelThumbBg
              :gd-id="previewGdId"
              :video-url="verificationUrl || null"
              res="medium"
              img-class="opacity-40"
              overlay-class="bg-gradient-to-r from-zinc-950 via-zinc-950/80 to-zinc-950/40"
            />
            <div class="relative px-3 py-2.5 flex items-center gap-3">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-zinc-100">{{ name || 'Untitled level' }}</span>
                <span class="block text-[11px] text-zinc-500 tabular-nums">ID {{ previewGdId }}</span>
              </span>
              <a
                :href="gdLevelUrl(previewGdId)!"
                target="_blank"
                rel="noopener"
                class="shrink-0 text-[11px] text-zinc-400 hover:text-accent transition-colors"
              >Open in GDBrowser ↗</a>
            </div>
          </div>
          <p v-else class="text-[11px] text-zinc-600">
            The level's thumbnail appears here once the ID is in — it's the quickest way to
            catch a wrong one.
          </p>
        </div>
      </section>

      <!-- Verification -->
      <details open class="group" :class="card">
        <summary :class="sectionHead" class="cursor-pointer select-none list-none hover:bg-zinc-900/40 transition-colors rounded-xl">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verification</h2>
          <span
            class="ml-auto text-[10px]"
            :class="verificationDone ? 'text-emerald-400' : 'text-amber-300/90'"
          >{{ verificationDone ? 'complete' : 'needs details' }}</span>
          <span class="text-zinc-600 text-[11px] group-open:rotate-180 transition-transform inline-block">▾</span>
        </summary>
        <div class="px-4 pb-4 space-y-3">
          <label class="block">
            <span :class="label">
              Verification link
              <span v-if="!isAdmin" class="text-red-400">*</span>
              <span v-else :class="hint">— optional for admins</span>
            </span>
            <input
              v-model="verificationUrl"
              data-field="verification_url"
              type="url"
              :required="!isAdmin"
              placeholder="https://www.youtube.com/watch?v=…"
              :class="field"
            />
            <span class="mt-1 block text-[11px] text-zinc-600">
              A YouTube link fills in the verification date from the upload for you.
            </span>
          </label>

          <div v-if="ytId" class="aspect-video rounded-lg border border-zinc-800 bg-black overflow-hidden">
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
              <span :class="label">Verifier <span class="text-red-400">*</span></span>
              <input
                v-model="verifier"
                data-field="verifier"
                placeholder="Player name"
                required
                :class="field"
              />
            </label>
            <label class="block">
              <span :class="label">
                Verification date <span class="text-red-400">*</span>
              </span>
              <div class="relative mt-1">
                <input
                  v-model="verifyDate"
                  data-field="verify_date"
                  type="date"
                  :disabled="dateLoading"
                  required
                  class="field field-md disabled:opacity-40 disabled:cursor-wait"
                />
                <span
                  v-if="dateLoading"
                  class="absolute inset-y-0 right-8 flex items-center pointer-events-none text-[11px] text-accent animate-pulse pr-1"
                >fetching…</span>
              </div>
            </label>
          </div>

          <p
            v-if="verificationWarning"
            class="text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded-lg px-3 py-2"
          >⚠ {{ verificationWarning }}</p>
        </div>
      </details>

      <!-- Difficulty. Open by default: it is the part a moderator actually
           needs, and the one section whose being shut hid a warning about
           where the submission would end up. -->
      <details open class="group" :class="card">
        <summary :class="sectionHead" class="cursor-pointer select-none list-none hover:bg-zinc-900/40 transition-colors rounded-xl">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty &amp; placement</h2>
          <span class="ml-auto flex items-center gap-1.5 text-[10px]">
            <span
              v-if="gddlTier"
              class="rounded px-1.5 py-0.5 font-semibold tabular-nums"
              :style="{ backgroundColor: tierColor(gddlTier), color: textOn(tierColor(gddlTier)) }"
            >{{ gddlTier }}</span>
            <span v-if="difficulty" class="rounded px-1.5 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-800">{{ difficulty }}</span>
            <span v-if="noOpinion" class="text-fuchsia-300/80">no tier — goes to void</span>
          </span>
          <span class="text-zinc-600 text-[11px] group-open:rotate-180 transition-transform inline-block">▾</span>
        </summary>
        <div class="px-4 pb-4 space-y-3">
          <!-- The comparison tool answers all three fields below at once, so it
               comes before them rather than being mentioned underneath. -->
          <div class="rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-3 py-2.5 flex items-center gap-3">
            <span class="text-[11px] text-zinc-500 flex-1">
              <template v-if="isChallenge">
                Not sure where it fits? Compare it against
                <span class="text-amber-300">other challenges</span> — the list opens on
                challenges only, ranked among themselves.
              </template>
              <template v-else>
                Not sure where it fits? Pick a level you'd call about as hard, and its tier,
                demon level and placement are filled in from that.
              </template>
            </span>
            <button
              type="button"
              class="shrink-0 rounded-lg border border-accent/60 text-accent hover:bg-accent/10 text-xs px-3 py-1.5 transition-colors"
              @click="openCompare"
            >{{ isChallenge ? 'Compare challenges' : 'Compare' }}</button>
          </div>

          <div
            v-if="comparisonLevel"
            class="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs flex items-center gap-2"
          >
            <span class="text-zinc-400 shrink-0">About as hard as</span>
            <span
              v-if="comparisonLevel.challenge_rank != null && isChallenge"
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums bg-amber-500/15 text-amber-300 border border-amber-500/40"
              title="Rank among challenges"
            >C#{{ comparisonLevel.challenge_rank }}</span>
            <span class="text-zinc-100 font-medium truncate">#{{ comparisonLevel.position }} {{ comparisonLevel.name }}</span>
            <span v-if="comparisonLevel.gddl_tier" class="text-zinc-500 shrink-0">· {{ comparisonLevel.gddl_tier }}</span>
            <span v-if="comparisonLevel.difficulty" class="text-zinc-500 shrink-0 hidden sm:inline">· {{ comparisonLevel.difficulty }}</span>
            <button type="button" class="ml-auto shrink-0 text-zinc-500 hover:text-red-400" @click="clearComparison">clear</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span :class="label">GDDL tier</span>
              <select v-model="gddlTier" :class="field">
                <option v-for="t in TIER_OPTIONS" :key="t" :value="t">{{ t || '— none —' }}</option>
              </select>
            </label>
            <div class="block">
              <span :class="label">Demon level</span>
              <select v-model="difficulty" :class="field">
                <option v-for="d in DIFFICULTY_OPTIONS" :key="d" :value="d">{{ d || '— none —' }}</option>
              </select>
              <label v-if="showChallenge" class="mt-2 flex items-center gap-2 cursor-pointer select-none flex-wrap">
                <input v-model="isChallenge" type="checkbox" class="accent-accent" />
                <span :class="label">Challenge</span>
                <span class="text-[11px] text-zinc-600">Under 30 seconds</span>
                <span v-if="isChallenge" class="text-[11px] text-amber-300/80">— Compare now shows challenges only</span>
              </label>
            </div>
          </div>

          <label class="block">
            <span :class="label">Placement estimate <span :class="hint">— roughly where on the list</span></span>
            <input
              v-model="placementEstimate"
              type="number" inputmode="numeric" min="1"
              placeholder="e.g. 42"
              :class="field"
            />
            <span v-if="tierPlacementNote" class="mt-1 block text-[11px] text-zinc-500">{{ tierPlacementNote }}</span>
          </label>

          <p
            v-if="noOpinion"
            class="text-xs text-fuchsia-300 bg-fuchsia-950/30 border border-fuchsia-900/50 rounded-lg px-3 py-2"
          >
            ⚠ Without a tier this goes to the
            <NuxtLink to="/void" class="underline hover:no-underline">void list</NuxtLink>
            rather than to pending — that's where levels nobody has given a difficulty to wait.
          </p>
        </div>
      </details>

      <!-- Extra info. Everything optional lives here, folded, so the form a
           first-time submitter meets is the five things it can't do without. -->
      <details class="group" :class="card">
        <summary :class="sectionHead" class="cursor-pointer select-none list-none hover:bg-zinc-900/40 transition-colors rounded-xl">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Extra info</h2>
          <span class="ml-auto text-[10px] text-zinc-600">All optional</span>
          <span class="text-zinc-600 text-[11px] group-open:rotate-180 transition-transform inline-block">▾</span>
        </summary>
        <div class="px-4 pb-4 space-y-3">
          <label class="block">
            <span :class="label">
              Source
              <span :class="hint">— where you found this level. Leave on "None" if it's first-party to the All Levels List.</span>
            </span>
            <SearchableSelect
              v-model="placementSource"
              :options="sourceOptions"
              empty-label="None"
              placeholder="None"
              class="mt-1"
            />
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span :class="label">Enjoyment <span :class="hint">0–10</span></span>
              <input
                v-model="enjoyment"
                type="number" min="0" max="10" step="0.1" inputmode="decimal"
                placeholder="e.g. 7.5"
                :class="field"
              />
            </label>
            <label class="block">
              <span :class="label">Rating</span>
              <select v-model="ratingOpinion" :class="field">
                <option v-for="r in RATING_OPTIONS" :key="r" :value="r">{{ r || '— none —' }}</option>
              </select>
            </label>
          </div>
          <label class="block">
            <span :class="label">Main skillset</span>
            <SearchableSelect
              v-model="skillset"
              :options="SKILLSET_OPTIONS.filter(Boolean)"
              empty-label="— none —"
              placeholder="— none —"
              class="mt-1"
            />
          </label>
          <div>
            <span :class="label">Suffix <span :class="hint">— prints after the name, as "Level (Suffix)"</span></span>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <label
                v-for="t in ALL_TAGS" :key="t"
                class="cursor-pointer select-none px-2 py-0.5 rounded-lg border text-[11px] transition-colors capitalize"
                :class="tagSet[t] ? 'border-accent/60 text-accent bg-accent/10' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
              >
                <input v-model="tagSet[t]" type="checkbox" class="sr-only" />
                {{ t === 'uldm' ? 'ULDM' : t }}
              </label>
            </div>
          </div>

          <!-- Duplicate / Alternate. Both say "this level is another level, in
               some way", and both then ask which one — so they share a box, and
               each picker appears inside the tick that asked for it rather than
               as a loose button between two checkboxes. -->
          <div class="rounded-lg border border-zinc-800/80 divide-y divide-zinc-800/80">
            <div class="p-3">
              <label class="flex items-start gap-2 cursor-pointer select-none">
                <input v-model="sameAsAbove" type="checkbox" class="mt-0.5 accent-accent" />
                <span>
                  <span class="block" :class="label">Duplicate</span>
                  <span class="block text-[11px] text-zinc-500 mt-0.5">
                    Same difficulty as the level above it, and tagged "Duplicate" on the list.
                    Example: Red Slaughterhouse, Trans Acu
                  </span>
                </span>
              </label>
              <div v-if="sameAsAbove" class="mt-2 pl-6 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="rounded-lg border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                  @click="duplicateOfPickerOpen = true"
                >{{ duplicateOfLevel ? 'Change…' : 'Pick original level…' }}</button>
                <span v-if="duplicateOfLevel" class="text-xs text-zinc-200 truncate">#{{ duplicateOfLevel.position }} {{ duplicateOfLevel.name }}</span>
                <button v-if="duplicateOfLevel" type="button" class="text-[11px] text-zinc-500 hover:text-red-400" @click="duplicateOfLevel = null">clear</button>
              </div>
            </div>

            <div class="p-3">
              <label class="flex items-start gap-2 cursor-pointer select-none">
                <input v-model="isAlternate" type="checkbox" class="mt-0.5 accent-accent" />
                <span>
                  <span class="block" :class="label">Alternate</span>
                  <span class="block text-[11px] text-zinc-500 mt-0.5">
                    A variation of an entry already on the list, and tagged "Alternate" on it.
                    Example: Tidal Wave (Buffed), Acheron (Zoink)
                  </span>
                </span>
              </label>
              <div v-if="isAlternate" class="mt-2 pl-6 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="rounded-lg border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                  @click="alternateOfPickerOpen = true"
                >{{ alternateOfLevel ? 'Change…' : 'Pick original level…' }}</button>
                <span v-if="alternateOfLevel" class="text-xs text-zinc-200 truncate">#{{ alternateOfLevel.position }} {{ alternateOfLevel.name }}</span>
                <button v-if="alternateOfLevel" type="button" class="text-[11px] text-zinc-500 hover:text-red-400" @click="alternateOfLevel = null">clear</button>
              </div>
            </div>
          </div>
        </div>
      </details>

      <!-- Notes -->
      <section :class="card">
        <div :class="sectionHead">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Notes for the mods</h2>
          <span class="ml-auto text-[10px] text-zinc-600">Optional</span>
        </div>
        <div class="px-4 pb-4">
          <textarea
            v-model="notes"
            rows="3"
            maxlength="4000"
            placeholder="Anything the moderator should know — context, comparisons, sources…"
            class="field field-md"
          />
        </div>
      </section>

      <p v-if="success" class="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-300">
        Submitted — pending review. You'll get an inbox message when a moderator decides.
      </p>
      <p v-if="error" class="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">{{ error }}</p>

      <!-- The bar names the first thing still missing and jumps to it. It used
           to report a count, which tells you there is work left without saying
           where — on a form whose fields are three collapsed sections deep. -->
      <div class="sticky bottom-0 -mx-4 px-4 py-3 bg-zinc-950/90 backdrop-blur border-t border-zinc-800/80 flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          :disabled="submitting"
          class="btn btn-md btn-primary"
        >{{ submitting ? 'Submitting…' : 'Submit for review' }}</button>
        <p v-if="firstMissing" class="text-[11px] text-amber-300/90">
          <button type="button" class="underline hover:no-underline" @click="focusField(firstMissing.field)">
            {{ firstMissing.label }}
          </button>
          still needed<template v-if="missingCount > 1">, and {{ missingCount - 1 }} more</template>.
        </p>
        <p v-else class="text-[11px] text-zinc-600">Everything required is filled in.</p>
      </div>
    </form>

    <!-- Original-level pickers for the Duplicate / Alternate tags -->
    <LevelComparisonDrawer
      v-model:open="duplicateOfPickerOpen"
      :confirm-on-pick="true"
      title="Pick the original level"
      hint="Click the level this one is a duplicate of."
      @confirm="(lvl) => (duplicateOfLevel = { id: lvl.id, position: lvl.position, name: lvl.name })"
    />
    <LevelComparisonDrawer
      v-model:open="alternateOfPickerOpen"
      :confirm-on-pick="true"
      title="Pick the original level"
      hint="Click the level this one is an alternate of."
      @confirm="(lvl) => (alternateOfLevel = { id: lvl.id, position: lvl.position, name: lvl.name })"
    />

    <!-- Level comparison drawer -->
    <Teleport to="body">
      <div v-if="compareOpen" class="fixed inset-0 z-50 flex">
        <div class="absolute inset-0 bg-black/60" @click="closeCompare" />
        <aside class="relative flex flex-col w-full sm:w-[420px] h-full bg-zinc-950 border-r border-zinc-800 shadow-2xl">
          <header class="p-3 border-b border-zinc-800 flex items-center gap-2 shrink-0">
            <div class="flex flex-col min-w-0">
              <span class="text-xs uppercase tracking-widest text-accent font-semibold flex items-center gap-2">
                {{ compareChallengeMode ? 'Challenge comparison' : 'Level comparison' }}
                <Badge v-if="compareChallengeMode" tone="amber" size="sm" title="Following the Challenge checkbox">Challenges only</Badge>
              </span>
              <span class="text-[11px] text-zinc-500">
                <template v-if="compareChallengeMode">
                  Challenges only, ranked among themselves. Pick one about as hard as yours.
                </template>
                <template v-else-if="compareMode === 'search'">Search, then click a level to browse nearby placements.</template>
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

          <div class="border-b border-zinc-800 shrink-0">
            <div class="p-3 flex items-center gap-2">
              <input
                v-model="compareSearch"
                type="search"
                placeholder="Search… [Tier], #placement, name"
                class="flex-1 min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                v-if="compareMode === 'browse'"
                type="button"
                class="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-100 px-2 py-1.5 rounded border border-zinc-800 hover:border-zinc-700 transition-colors"
                @click="backToSearch"
              >Back to search</button>
            </div>
            <!-- List filter + rating filter -->
            <div class="px-3 pb-2.5 flex items-center gap-3 flex-wrap">
              <div class="flex items-center gap-1">
                <span class="text-[10px] uppercase tracking-widest text-zinc-600 mr-1">List</span>
                <button
                  v-for="[val, label] in [['', 'All'], ['aredl', 'AREDL'], ['gdl', 'Global']]"
                  :key="val"
                  type="button"
                  class="px-2 py-0.5 rounded border text-[11px] transition-colors"
                  :class="compareExternalList === val
                    ? 'border-accent/60 text-accent bg-accent/10'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700'"
                  @click="compareExternalList = val"
                >{{ label }}</button>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] uppercase tracking-widest text-zinc-600">Rating</span>
                <select
                  v-model="compareRatingFilter"
                  class="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300 focus:border-accent focus:outline-none"
                  :class="compareRatingFilter ? 'border-accent/60 text-accent bg-accent/10' : ''"
                  :title="compareChallengeMode ? 'Set by the Challenge checkbox — change it here to browse everything' : undefined"
                >
                  <option value="">All</option>
                  <option value="Unrated">Unrated</option>
                  <option value="Rated">Rated</option>
                  <option value="Challenge">Challenge</option>
                </select>
              </div>
            </div>
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
                  <!-- In challenge mode the number that matters is the rank
                       among challenges, not the level's place in a list of
                       54,000 that mostly isn't challenges. The list position
                       is still printed, quietly, because that is what the
                       placement estimate below is filled in with. -->
                  <span
                    class="text-[11px] tabular-nums px-2 py-1 w-14 shrink-0 text-center font-medium"
                    :style="{ backgroundColor: tierColor(lvl.gddl_tier), color: textOn(tierColor(lvl.gddl_tier)) }"
                  >
                    <template v-if="compareChallengeMode && lvl.challenge_rank != null">C#{{ lvl.challenge_rank }}</template>
                    <template v-else>#{{ lvl.position }}</template>
                  </span>
                  <span class="truncate flex-1">{{ lvl.name }}</span>
                  <span
                    v-if="compareChallengeMode && lvl.challenge_rank != null"
                    class="text-[10px] opacity-50 shrink-0 tabular-nums"
                  >#{{ lvl.position }}</span>
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
                Selected:
                <span class="text-zinc-100 font-medium">
                  <template v-if="compareChallengeMode && comparePicked.challenge_rank != null">C#{{ comparePicked.challenge_rank }}</template>
                  <template v-else>#{{ comparePicked.position }}</template>
                  {{ comparePicked.name }}
                </span>
              </template>
              <template v-else>
                <span class="text-zinc-600">No level selected.</span>
              </template>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              @click="closeCompare"
            >Cancel</button>
            <button
              type="button"
              :disabled="!comparePicked"
              class="btn btn-sm btn-primary"
              @click="confirmCompare"
            >Confirm</button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { gdLevelUrl } from '~/utils/gd-links'
import { parseTierShortcut } from '~/utils/tier-shortcut'
import { tierColor, textOn } from '~/utils/tier-colors'
import { TIER_MAX_ORD, ordToTier } from '~/utils/tier-ordinal'

type PendingLevel = {
  id: number
  gd_id: number | null
  name: string | null
  fps: string | null
  game_version: string | null
  verification: string | null
  verification_url: string | null
  verifier: string | null
  verify_date: string | null
  gddl_tier: string | null
  gddl_tier_estimated: number
  difficulty: string | null
  enjoyment: number | null
  main_skillset: string | null
  tags: string | null
  notes: string | null
  placement_source: string | null
  submitted_at: string
  submitter: string | null
  placement_estimate: number | null
  /** The two levels the estimate would land between — see `pending.get.ts`. */
  est_above_name?: string | null
  est_above_position?: number | null
  est_below_name?: string | null
  est_below_position?: number | null
  comparison_level_id: number | null
  comparison_level_name: string | null
  from_open_verification_id: number | null
  from_void_level_id: number | null
  same_as_above: number
  duplicate_of_id: number | null
  is_alternate: number
  alternate_of_id: number | null
  tentative_placement: number
  rated: string | null
  from_gdl_id: number | null
  from_gdtpl_id: number | null
  from_acs_id?: number | null
  acs_position?: number | null
  from_sheet_pending: number
  gdtpl_list_slug: string | null
  gdtpl_position: number | null
  potential_duplicate_position: number | null
  potential_duplicate_name: string | null
}

// 'submitted' (default) drives the user-submission queue; 'gdl_import' drives
// the GDL-imported queue. Both render the same UI with a few label tweaks.
const props = withDefaults(defineProps<{ source?: 'submitted' | 'gdl_import' }>(), {
  source: 'submitted',
})
const isImported = computed(() => props.source === 'gdl_import')

type PreviewRow = { position: number; name: string; rated: string | null; gddl_tier: string | null; difficulty: string | null }
type Preview = {
  placement: number
  above: PreviewRow[]
  below: PreviewRow[]
  featuredAbove: PreviewRow | null
  featuredBelow: PreviewRow | null
}

const items = ref<PendingLevel[]>([])
const selectedId = ref<number | null>(null)
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
const decideLoading = ref(false)
const placement = ref<string>('')
const preview = ref<Preview | null>(null)
const previewLoading = ref(false)
const rejectReason = ref<string>('')
const flagsOpen = ref(false)
const isDuplicate = ref(false)
const duplicateOfId = ref<number | null>(null)
const draftDuplicateOf = ref<{ position: number; name: string } | null>(null)
const flagsDuplicatePickerOpen = ref(false)
const isAlternate = ref(false)
const isTentative = ref(false)
const alternateOfId = ref<number | null>(null)
const draftAlternateOf = ref<{ position: number; name: string } | null>(null)
const flagsAlternatePickerOpen = ref(false)
const placementSaved = ref(false)
let placementSaveDebounce: ReturnType<typeof setTimeout> | null = null
const flagsSaved = ref(false)
let flagsSaveDebounce: ReturnType<typeof setTimeout> | null = null
let tierSaveDebounce: ReturnType<typeof setTimeout> | null = null

// --- Pending-list filters ---
const PENDING_TAGS = ['old', 'uldm', 'buffed', 'nerfed'] as const
type DifficultyFilter = 'all' | 'extreme' | 'non-extreme'
type PendingSort = 'submitted' | 'challenge_first' | 'tier_asc' | 'tier_desc' | 'list_position'
const filtersOpen = ref(false)
const search = ref('')
const difficultyFilter = ref<DifficultyFilter>('all')
// The auto-import queue mixes hundreds of GDL/GDTPL/sheet rows in arbitrary
// submission order; sorting by tier desc surfaces the hardest unreviewed
// imports first, which is what mods want by default. User submissions stay
// in submission order so chronological review still works.
const pendingSort = ref<PendingSort>(props.source === 'gdl_import' ? 'tier_desc' : 'submitted')
const tierMin = ref(0)
const tierMax = ref(TIER_MAX_ORD)
const pendingTagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })
type PotentialDupMode = 'show' | 'only' | 'hide'
const potentialDuplicateMode = ref<PotentialDupMode>('show')
// Imported-levels source filter — only meaningful when source='gdl_import',
// which mixes GDL, GDTPL (TSL/EDI/CCL/…), and sheet-pending rows in one queue.
// Built-in keys are 'all' / 'sheet' / 'gdl'; any other value is interpreted as
// a gdtpl_levels.list_slug, so adding a new GDListTemplate-based list (CCL,
// etc.) makes its filter chip appear automatically once any of its rows land
// in the pending queue.
const importSourceFilter = ref<string>('all')

const IMPORT_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all',   label: 'All' },
  { value: 'sheet', label: 'Sheet' },
  { value: 'gdl',   label: 'GDL' },
  { value: 'tsl',   label: 'TSL' },
  { value: 'edi',   label: 'EDI' },
  { value: 'ccl',   label: 'CCL' },
  { value: 'll',    label: 'LL' },
  { value: 'tcl',   label: 'TCL' },
  { value: 'sfl',   label: 'SFL' },
  { value: 'ddl',   label: 'DDL' },
  { value: 'cl',    label: 'CL' },
  // The project's own challenge sheet. Keyed on its own marker column rather
  // than a gdtpl slug, so it needs its own branch in the matcher below.
  { value: 'acs',   label: 'ACS' },
]
const importSourceOptions = IMPORT_SOURCE_OPTIONS

function tierOrd(label: string | null): number | null {
  if (!label) return null
  const sub = label.match(/^Subtier (\d{1,2})$/)
  if (sub) return Number(sub[1])
  const t = label.match(/^Tier (\d{1,2})$/)
  if (t) return 5 + Number(t[1])
  return null
}

const filteredItems = computed<PendingLevel[]>(() => {
  const q = search.value.trim().toLowerCase()
  const activeTags = PENDING_TAGS.filter((t) => pendingTagSet[t])
  const tierBounded = tierMin.value > 0 || tierMax.value < TIER_MAX_ORD
  const filtered = items.value.filter((r) => {
    if (q) {
      const hay = `${r.name ?? ''} ${r.gd_id ?? ''} ${r.submitter ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (difficultyFilter.value === 'extreme' && r.difficulty !== 'Extreme Demon') return false
    if (difficultyFilter.value === 'non-extreme' && r.difficulty === 'Extreme Demon') return false
    if (tierBounded) {
      const ord = tierOrd(r.gddl_tier)
      if (ord == null) return false
      if (ord < tierMin.value || ord > tierMax.value) return false
    }
    if (activeTags.length) {
      const lower = (r.tags ?? '').toLowerCase()
      for (const t of activeTags) {
        if (!lower.split(',').map((x) => x.trim()).includes(t)) return false
      }
    }
    if (potentialDuplicateMode.value === 'only' && r.potential_duplicate_position == null) return false
    if (potentialDuplicateMode.value === 'hide' && r.potential_duplicate_position != null) return false
    if (isImported.value && importSourceFilter.value !== 'all') {
      const slug = (r.gdtpl_list_slug ?? '').toLowerCase()
      const f = importSourceFilter.value
      if (f === 'sheet')      { if (!r.from_sheet_pending) return false }
      else if (f === 'gdl')   { if (!r.from_gdl_id)        return false }
      else if (f === 'acs')   { if (!r.from_acs_id)        return false }
      else                    { if (slug !== f)            return false }
    }
    return true
  })
  const sort = pendingSort.value
  if (sort === 'submitted') return filtered
  return [...filtered].sort((a, b) => {
    if (sort === 'challenge_first') {
      const ac = a.rated === 'Challenge' ? 0 : 1
      const bc = b.rated === 'Challenge' ? 0 : 1
      return ac - bc
    }
    if (sort === 'list_position') {
      const ap = a.gdtpl_position ?? Infinity
      const bp = b.gdtpl_position ?? Infinity
      return ap - bp
    }
    const ao = tierOrd(a.gddl_tier) ?? (sort === 'tier_asc' ? Infinity : -Infinity)
    const bo = tierOrd(b.gddl_tier) ?? (sort === 'tier_asc' ? Infinity : -Infinity)
    return sort === 'tier_asc' ? ao - bo : bo - ao
  })
})

const activeFilterCount = computed(() => {
  let n = 0
  if (search.value.trim()) n++
  if (difficultyFilter.value !== 'all') n++
  if (pendingSort.value !== (props.source === 'gdl_import' ? 'tier_desc' : 'submitted')) n++
  if (tierMin.value > 0 || tierMax.value < TIER_MAX_ORD) n++
  if (PENDING_TAGS.some((t) => pendingTagSet[t])) n++
  if (potentialDuplicateMode.value !== 'show') n++
  if (isImported.value && importSourceFilter.value !== 'all') n++
  return n
})

function resetFilters() {
  search.value = ''
  difficultyFilter.value = 'all'
  pendingSort.value = props.source === 'gdl_import' ? 'tier_desc' : 'submitted'
  tierMin.value = 0
  tierMax.value = TIER_MAX_ORD
  for (const t of PENDING_TAGS) pendingTagSet[t] = false
  potentialDuplicateMode.value = 'show'
  importSourceFilter.value = 'all'
}

// Tier range guards
watch(tierMin, () => { if (tierMin.value > tierMax.value) tierMin.value = tierMax.value })
watch(tierMax, () => { if (tierMax.value < tierMin.value) tierMax.value = tierMin.value })

// Tier shortcut: [20] or [20.75] in the search box sets the tier filter and
// selects the item at that fraction through the matching submissions.
watch(search, () => {
  const result = parseTierShortcut(search.value)
  if (!result) return
  const ord = tierOrd(result.tier)
  if (ord == null) return
  search.value = ''
  tierMin.value = ord
  tierMax.value = ord
  nextTick(() => {
    const list = filteredItems.value
    if (list.length === 0) return
    const idx = Math.min(list.length - 1, Math.floor((1 - result.frac) * list.length))
    selectedId.value = list[idx]!.id
  })
})

// If the currently-selected submission is filtered out, fall back to the first
// surviving row so the detail panel doesn't show a stale entry.
watch(filteredItems, (list) => {
  if (selectedId.value && !list.some((r) => r.id === selectedId.value)) {
    selectedId.value = list[0]?.id ?? null
  }
})

const selected = computed(() => items.value.find((r) => r.id === selectedId.value) ?? null)

const goesToVoid = computed(() => {
  if (!selected.value) return false
  return !selected.value.gddl_tier && !selected.value.difficulty
})

async function load() {
  const res = await $fetch<{ items: PendingLevel[] }>('/api/admin/levels/pending', {
    query: { source: props.source },
  })
  items.value = res.items
  if (selectedId.value && !items.value.some((r) => r.id === selectedId.value)) {
    selectedId.value = items.value[0]?.id ?? null
  } else if (!selectedId.value && items.value[0]) {
    selectedId.value = items.value[0].id
  }
}
onMounted(load)
// Reload when the parent swaps tabs without unmounting (admin.vue v-if guards
// against this, but be defensive in case of future refactors).
watch(() => props.source, load)

watch(selected, async (s) => {
  // Skip full reset when the same level's in-memory record was updated (e.g.
  // after autoSaveFlags syncs items.value) — only reset on actual level switch.
  if (s?.id === lastLoadedId) return
  lastLoadedId = s?.id ?? null
  if (tierSaveDebounce) { clearTimeout(tierSaveDebounce); tierSaveDebounce = null }
  preview.value = null
  // Pre-fill tier from the level's own stored value. For difficulty, if the
  // level has an estimated placement let the preview watcher inherit from the
  // level above instead of using the importer's value (which may be from a
  // different list's difficulty scale). The preview watcher only fills if empty.
  tierOverride.value = s?.gddl_tier ?? ''
  difficultyOverride.value = s?.placement_estimate != null ? '' : (s?.difficulty ?? '')
  isDuplicate.value = !!s?.same_as_above
  duplicateOfId.value = s?.duplicate_of_id ?? null
  draftDuplicateOf.value = null
  isAlternate.value = !!s?.is_alternate
  alternateOfId.value = s?.alternate_of_id ?? null
  draftAlternateOf.value = null
  isTentative.value = !!s?.tentative_placement
  placement.value = ''
  // For estimated-tier levels the import's placement_estimate comes from
  // position interpolation on the source list and may not fall inside the
  // estimated tier. Use the tier midpoint instead so tier and placement are
  // always consistent. For manually-set tiers (gddl_tier_estimated = 0) or
  // levels without a tier, trust the raw placement_estimate.
  if (s?.gddl_tier && s?.gddl_tier_estimated) {
    const tier = s.gddl_tier
    try {
      const res = await $fetch<{ midpoint: number | null }>('/api/admin/levels/tier-midpoint', {
        query: { tier },
      })
      if (selected.value?.id === s.id && res.midpoint != null) {
        placement.value = String(res.midpoint)
      }
    } catch { /* non-fatal */ }
    return
  }
  if (s?.placement_estimate != null) {
    placement.value = String(s.placement_estimate)
    return
  }
  // No estimate at all — fall back to the midpoint of the tier.
  if (s?.gddl_tier) {
    const tier = s.gddl_tier
    try {
      const res = await $fetch<{ midpoint: number | null }>('/api/admin/levels/tier-midpoint', {
        query: { tier },
      })
      if (selected.value?.id === s.id && res.midpoint != null && !placement.value) {
        placement.value = String(res.midpoint)
      }
    } catch { /* non-fatal */ }
  }
})

let placementDebounce: ReturnType<typeof setTimeout> | null = null
watch(placement, (v) => {
  if (placementDebounce) clearTimeout(placementDebounce)
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) {
    preview.value = null
    return
  }
  placementDebounce = setTimeout(async () => {
    previewLoading.value = true
    try {
      preview.value = await $fetch<Preview>('/api/admin/levels/placement-preview', { query: { position: n } })
    } catch {
      preview.value = null
    } finally {
      previewLoading.value = false
    }
  }, 200)
  // Auto-save placement_estimate to DB after a short delay
  if (placementSaveDebounce) clearTimeout(placementSaveDebounce)
  if (selected.value) {
    placementSaveDebounce = setTimeout(async () => {
      try {
        await $fetch(`/api/admin/levels/pending/${selected.value!.id}`, {
          method: 'POST', body: { action: 'save_placement', placement: n },
        })
        placementSaved.value = true
        setTimeout(() => (placementSaved.value = false), 1500)
      } catch { /* non-fatal */ }
    }, 600)
  }
})

let lastLoadedId: number | null = null

function autoSaveFlags() {
  if (!selected.value) return
  if (flagsSaveDebounce) clearTimeout(flagsSaveDebounce)
  const id = selected.value.id
  flagsSaveDebounce = setTimeout(async () => {
    try {
      await $fetch(`/api/admin/levels/pending/${id}`, {
        method: 'POST',
        body: {
          action: 'save_flags',
          same_as_above: isDuplicate.value,
          duplicate_of_id: isDuplicate.value ? (duplicateOfId.value ?? null) : null,
          is_alternate: isAlternate.value,
          alternate_of_id: isAlternate.value ? (alternateOfId.value ?? null) : null,
          tentative_placement: isTentative.value,
        },
      })
      // Sync the in-memory item so re-selecting this level doesn't reset the flags.
      const idx = items.value.findIndex(r => r.id === id)
      if (idx >= 0) {
        items.value[idx] = {
          ...items.value[idx]!,
          same_as_above: isDuplicate.value ? 1 : 0,
          duplicate_of_id: isDuplicate.value ? (duplicateOfId.value ?? null) : null,
          is_alternate: isAlternate.value ? 1 : 0,
          alternate_of_id: isAlternate.value ? (alternateOfId.value ?? null) : null,
          tentative_placement: isTentative.value ? 1 : 0,
        }
      }
      flagsSaved.value = true
      setTimeout(() => (flagsSaved.value = false), 1500)
    } catch { /* non-fatal */ }
  }, 400)
}

function autoSaveTierDifficulty() {
  if (!selected.value) return
  if (tierSaveDebounce) clearTimeout(tierSaveDebounce)
  const id = selected.value.id
  tierSaveDebounce = setTimeout(async () => {
    const t = tierOverride.value.trim()
    const d = difficultyOverride.value.trim()
    const fields: Record<string, unknown> = {}
    if (t) fields.gddl_tier = t
    if (d) fields.difficulty = d
    if (Object.keys(fields).length === 0) return
    try {
      await $fetch(`/api/admin/levels/pending/${id}`, {
        method: 'POST',
        body: { action: 'save_metadata', fields },
      })
      const idx = items.value.findIndex(r => r.id === id)
      if (idx >= 0) {
        items.value[idx] = {
          ...items.value[idx]!,
          ...(t ? { gddl_tier: t, gddl_tier_estimated: 0 } : {}),
          ...(d ? { difficulty: d } : {}),
        }
      }
    } catch { /* non-fatal */ }
  }, 600)
}

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3500)
}

async function decide(action: 'approve' | 'reject' | 'await') {
  if (!selected.value || decideLoading.value) return
  if (action === 'approve') {
    const n = Number(placement.value)
    if (!Number.isInteger(n) || n <= 0) {
      flash('err', 'Enter a placement (1-based) before approving.')
      return
    }
  }
  decideLoading.value = true
  try {
    const body: any = {
      action,
      same_as_above: isDuplicate.value,
      duplicate_of_id: isDuplicate.value ? (duplicateOfId.value ?? null) : null,
      is_alternate: isAlternate.value,
      alternate_of_id: isAlternate.value ? (alternateOfId.value ?? null) : null,
      tentative_placement: isTentative.value,
    }
    if (action === 'approve') {
      body.placement = Number(placement.value)
      if (tierOverride.value.trim()) body.gddl_tier = tierOverride.value.trim()
      if (difficultyOverride.value.trim()) body.difficulty = difficultyOverride.value.trim()
    }
    if (action === 'await') {
      const n = Number(awaitPlacementSuggestion.value)
      if (Number.isInteger(n) && n > 0) body.placement_suggestion = n
      if (tierOverride.value.trim()) body.gddl_tier = tierOverride.value.trim()
      if (difficultyOverride.value.trim()) body.difficulty = difficultyOverride.value.trim()
    }
    if (action === 'reject') body.reason = rejectReason.value.trim() || undefined
    const res = await $fetch<{ ok: boolean; voided?: boolean; awaiting?: boolean }>(`/api/admin/levels/pending/${selected.value.id}`, {
      method: 'POST', body,
    })
    if (action === 'approve') {
      flash('ok', res.voided ? 'Approved — added to the void list.' : 'Approved — added to the main list.')
    } else if (action === 'await') {
      flash('ok', 'Sent to awaiting placement.')
    } else {
      flash('ok', 'Submission rejected.')
    }
    // Move to the next submission in the queue, not back to the top. Reviewing
    // is a pass down a list; every decision used to throw the reviewer back to
    // row one and make them find their place again.
    selectedId.value = nextIdAfter(selected.value?.id ?? null)
    placement.value = ''
    tierOverride.value = ''
    difficultyOverride.value = ''
    awaitPlacementSuggestion.value = ''
    rejectReason.value = ''
    isDuplicate.value = false
    duplicateOfId.value = null
    draftDuplicateOf.value = null
    isAlternate.value = false
    alternateOfId.value = null
    draftAlternateOf.value = null
    isTentative.value = false
    placementSaved.value = false
    preview.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    decideLoading.value = false
  }
}

/**
 * What a submission still needs before it can go on the list.
 *
 * The detail panel used to answer this as six tiles that mostly said "—", so
 * telling a complete submission from one missing its verifier meant reading all
 * of them. Naming the gaps is the same move the public submit form makes, and
 * it's what a reviewer is actually looking for.
 */
function missingFields(r: PendingLevel): string[] {
  const gaps: string[] = []
  if (r.gd_id == null) gaps.push('level ID')
  if (!r.name) gaps.push('name')
  if (!r.verifier) gaps.push('verifier')
  if (!r.verify_date) gaps.push('verify date')
  if (!r.verification_url) gaps.push('video')
  if (!r.gddl_tier) gaps.push('tier')
  return gaps
}
const selectedMissing = computed(() => (selected.value ? missingFields(selected.value) : []))

/**
 * How many rows in the current view need nothing before they can be placed.
 *
 * Each row already carries a green or amber dot; this is the same fact for the
 * queue as a whole, and it is what tells a reviewer whether there is an hour of
 * chasing missing videos ahead of them or a run of easy placements.
 */
const readyCount = computed(() => filteredItems.value.filter((r) => !missingFields(r).length).length)

/** "3d" rather than "2026-07-31 12:04:11" — the queue is scanned, not read. */
function relativeAge(at: string): string {
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return at
  const secs = Math.max(0, (Date.now() - t) / 1000)
  if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  const days = Math.floor(secs / 86400)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo` : `${Math.floor(days / 365)}y`
}

/**
 * How much of the queue is actually in the DOM.
 *
 * The imported queue is fourteen hundred rows, and every one of them carries a
 * thumbnail, five conditional badges and a source line — so the panel was
 * building fourteen hundred of those to show the twelve you can see. Rendering
 * a window and growing it as you scroll costs nothing to the reviewer (the
 * scrollbar is the only tell) and takes the row count on first paint from
 * 1,454 to 60.
 *
 * The window also grows to include whatever `j`/`k` lands on, so keyboard
 * navigation is never stopped by the edge of it.
 */
const WINDOW_STEP = 60
const windowSize = ref(WINDOW_STEP)
const windowedItems = computed(() => filteredItems.value.slice(0, windowSize.value))
const windowHasMore = computed(() => windowSize.value < filteredItems.value.length)

// A new filter or sort is a new queue: start from the top of it.
watch(filteredItems, () => { windowSize.value = WINDOW_STEP })

const queueSentinel = ref<HTMLElement | null>(null)
const queueScroller = ref<HTMLElement | null>(null)
let queueObserver: IntersectionObserver | null = null
onMounted(() => {
  if (!queueSentinel.value || !queueScroller.value) return
  queueObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && windowHasMore.value) windowSize.value += WINDOW_STEP
    },
    { root: queueScroller.value, rootMargin: '400px 0px' },
  )
  queueObserver.observe(queueSentinel.value)
})
onBeforeUnmount(() => queueObserver?.disconnect())

/** The row after `id` in the queue as it's currently filtered and sorted. */
function nextIdAfter(id: number | null): number | null {
  const rows = filteredItems.value
  if (!rows.length) return null
  const i = rows.findIndex((r) => r.id === id)
  if (i === -1) return rows[0]!.id
  return (rows[i + 1] ?? rows[i - 1] ?? null)?.id ?? null
}

/**
 * j/k (and the arrow keys) walk the queue.
 *
 * Reviewing an imported queue is a few hundred near-identical decisions, and
 * every one of them was a trip to the mouse. Ignored while typing, so the
 * search box and the placement field still work normally.
 */
function onReviewKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const rows = filteredItems.value
  if (!rows.length) return
  const dir = e.key === 'j' || e.key === 'ArrowDown' ? 1
    : e.key === 'k' || e.key === 'ArrowUp' ? -1
      : 0
  if (!dir) return
  e.preventDefault()
  const i = rows.findIndex((r) => r.id === selectedId.value)
  const next = i === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, i + dir))
  selectedId.value = rows[next]!.id
  // Walking past the end of the rendered window extends it, so the keyboard
  // can reach the whole queue however little of it is currently drawn.
  if (next >= windowSize.value) windowSize.value = next + WINDOW_STEP
  // Keep the moving selection on screen.
  nextTick(() => {
    document.querySelector(`[data-pending-row="${selectedId.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}
onMounted(() => document.addEventListener('keydown', onReviewKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onReviewKey))


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
const verificationYtId = computed(() => youtubeId(selected.value?.verification_url ?? null))

// Placement helper: same comparison drawer the submit-level page uses. On
// pick, set `placement` to the position right below the chosen level — it'll
// shift everything at-and-below down by one when approved.
type ListLevel = { position: number; name: string; gddl_tier: string | null; difficulty: string | null }
const placementHelperOpen = ref(false)
function onPlacementHelperPick(picked: ListLevel) {
  placement.value = String(picked.position + 1)
  if (picked.gddl_tier) tierOverride.value = picked.gddl_tier
  if (picked.difficulty) difficultyOverride.value = picked.difficulty
  autoSaveTierDifficulty()
}

function onFlagsDuplicatePick(lvl: ListLevel) {
  duplicateOfId.value = lvl.id ?? null
  draftDuplicateOf.value = { position: lvl.position, name: lvl.name }
  autoSaveFlags()
}
function onFlagsAlternatePick(lvl: ListLevel) {
  alternateOfId.value = lvl.id ?? null
  draftAlternateOf.value = { position: lvl.position, name: lvl.name }
  autoSaveFlags()
}

// Tier + difficulty auto-fill: inherit from the level immediately above the placement.
const tierOverride = ref('')
const difficultyOverride = ref('')
const awaitPlacementSuggestion = ref('')

// --- Inline metadata edit (mirrors LevelDetail's edit panel for the main list) ---
const editing = ref(false)
const editSaving = ref(false)
const editError = ref<string | null>(null)
type EditableMetadata = {
  name: string
  gd_id: string
  verifier: string
  verify_date: string
  gddl_tier: string
  difficulty: string
  enjoyment: string
  main_skillset: string
  placement_source: string
  rated: string
  verification: string
  verification_url: string
  tags: string
  notes: string
}
const editDraft = reactive<EditableMetadata>({
  name: '', gd_id: '', verifier: '', verify_date: '',
  gddl_tier: '', difficulty: '', enjoyment: '', main_skillset: '',
  placement_source: '', rated: '',
  verification: '', verification_url: '', tags: '', notes: '',
})

function startEdit() {
  if (!selected.value) return
  const s = selected.value
  editDraft.name = s.name ?? ''
  editDraft.gd_id = s.gd_id != null ? String(s.gd_id) : ''
  editDraft.verifier = s.verifier ?? ''
  editDraft.verify_date = s.verify_date ?? ''
  editDraft.gddl_tier = s.gddl_tier ?? ''
  editDraft.difficulty = s.difficulty ?? ''
  editDraft.enjoyment = s.enjoyment != null ? String(s.enjoyment) : ''
  editDraft.main_skillset = s.main_skillset ?? ''
  editDraft.placement_source = s.placement_source ?? ''
  editDraft.rated = s.rated ?? ''
  editDraft.verification = s.verification ?? ''
  editDraft.verification_url = s.verification_url ?? ''
  editDraft.tags = s.tags ?? ''
  editDraft.notes = s.notes ?? ''
  editError.value = null
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  editError.value = null
}
// Drop edit state when switching submissions so the form doesn't leak the
// previous level's draft into the new selection.
watch(selectedId, () => { editing.value = false; editError.value = null })

async function saveEdit() {
  if (!selected.value || editSaving.value) return
  editSaving.value = true
  editError.value = null
  try {
    const fields: Record<string, unknown> = {
      name: editDraft.name.trim() || null,
      gd_id: editDraft.gd_id.trim() === '' ? null : Number(editDraft.gd_id.trim()),
      verifier: editDraft.verifier.trim(),
      verify_date: editDraft.verify_date.trim(),
      gddl_tier: editDraft.gddl_tier.trim(),
      difficulty: editDraft.difficulty.trim(),
      enjoyment: editDraft.enjoyment.trim() === '' ? null : Number(editDraft.enjoyment.trim()),
      main_skillset: editDraft.main_skillset.trim(),
      placement_source: editDraft.placement_source.trim(),
      rated: editDraft.rated.trim(),
      verification: editDraft.verification.trim(),
      verification_url: editDraft.verification_url.trim(),
      tags: editDraft.tags.trim(),
      notes: editDraft.notes.trim(),
    }
    if (fields.gd_id != null && (!Number.isInteger(fields.gd_id) || (fields.gd_id as number) <= 0)) {
      throw createError({ statusMessage: 'Level ID must be a positive integer.' })
    }
    await $fetch(`/api/admin/levels/pending/${selected.value.id}`, {
      method: 'POST', body: { action: 'save_metadata', fields },
    })
    editing.value = false
    await load()
  } catch (e: any) {
    editError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Save failed.'
  } finally {
    editSaving.value = false
  }
}
/**
 * What an estimate sits between, in words.
 *
 * An imported level arrives carrying a number and nothing else, and a bare
 * "#4,312" out of fifty thousand is not something anyone can agree or disagree
 * with. The two levels that would end up either side of it are — they are the
 * comparison the reviewer was going to make by hand anyway.
 */
type EstimateNeighbour = { name: string; position: number | null }
function estimateNeighbours(r: PendingRow | null): {
  above: EstimateNeighbour | null
  below: EstimateNeighbour | null
} {
  return {
    above: r?.est_above_name ? { name: r.est_above_name, position: r.est_above_position ?? null } : null,
    below: r?.est_below_name ? { name: r.est_below_name, position: r.est_below_position ?? null } : null,
  }
}

/** The same thing as one string, for the queue row's tooltip. */
function estimateTitle(r: PendingRow): string {
  const head = isImported.value
    ? `Estimated placement #${r.placement_estimate?.toLocaleString()}`
    : `Placement the submitter estimated: #${r.placement_estimate?.toLocaleString()}`
  const { above, below } = estimateNeighbours(r)
  const at = (n: EstimateNeighbour) =>
    n.position != null ? `${n.name} (#${n.position.toLocaleString()})` : n.name
  if (above && below) return `${head} — between ${at(above)} and ${at(below)}`
  if (above) return `${head} — just below ${at(above)}`
  if (below) return `${head} — just above ${at(below)}`
  return head
}

watch(preview, (p) => {
  if (!p) return
  const above = p.above[p.above.length - 1]
  // Only fall back to the level-above values if the pending level itself
  // has no tier/difficulty — prevents the neighbour from overwriting the
  // import's estimated tier.
  if (!tierOverride.value && above?.gddl_tier) tierOverride.value = above.gddl_tier
  if (!difficultyOverride.value && above?.difficulty) difficultyOverride.value = above.difficulty
})
</script>

<template>
  <!-- Percentage columns squeezed the review panel to nothing on a laptop and
       let the queue sprawl on a wide monitor. Both side panels now have a
       floor and a ceiling; the middle takes whatever is left. -->
  <div class="grid grid-cols-[minmax(15rem,20%)_minmax(0,1fr)_minmax(17rem,25%)] grid-rows-[minmax(0,1fr)] h-full">
    <!-- Left: pending list -->
    <aside class="flex flex-col min-h-0 overflow-hidden border-r border-zinc-800 bg-zinc-950">
      <div class="p-3 border-b border-zinc-800 shrink-0">
        <div class="flex items-baseline justify-between gap-2 mb-2">
          <p class="text-[10px] uppercase tracking-widest text-accent font-semibold">{{ isImported ? 'Imported levels' : 'Pending levels' }}</p>
          <p class="text-[11px] text-zinc-600 tabular-nums">
            <template v-if="filteredItems.length !== items.length">
              <span class="text-zinc-400">{{ filteredItems.length.toLocaleString() }}</span> of {{ items.length.toLocaleString() }}
            </template>
            <template v-else>{{ items.length.toLocaleString() }} waiting</template>
          </p>
        </div>
        <!-- Said out loud rather than hidden in a tooltip: it is the difference
             between a few hundred trips to the mouse and none. -->
        <p v-if="filteredItems.length > 1" class="text-[10px] text-zinc-700 mb-2">
          <kbd class="px-1 py-px rounded border border-zinc-800 bg-zinc-900 text-zinc-500">j</kbd>
          /
          <kbd class="px-1 py-px rounded border border-zinc-800 bg-zinc-900 text-zinc-500">k</kbd>
          moves through the queue
          <span v-if="readyCount" class="ml-1.5">· {{ readyCount.toLocaleString() }} ready to place</span>
        </p>
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
            aria-label="Advanced filter"
            title="Advanced filter"
            @click="filtersOpen = !filtersOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
              <path d="M3 4h18l-7 9v6l-4 2v-8z" />
            </svg>
            <span v-if="activeFilterCount" class="tabular-nums">{{ activeFilterCount }}</span>
          </button>
          <button
            v-if="activeFilterCount && !filtersOpen"
            type="button"
            class="shrink-0 px-2 rounded border border-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-900/60 text-xs transition-colors"
            title="Clear all filters"
            @click="resetFilters"
          >✕</button>
        </div>

        <div v-if="filtersOpen" class="mt-3 space-y-3 text-xs rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
          <!-- Import source — only on the imported-levels queue, which mixes
               GDL / GDTPL / sheet-pending rows. -->
          <div v-if="isImported">
            <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Source</div>
            <div class="flex flex-wrap gap-1.5">
              <label
                v-for="opt in importSourceOptions"
                :key="opt.value"
                class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                :class="importSourceFilter === opt.value
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
              >
                <input v-model="importSourceFilter" type="radio" :value="opt.value" class="sr-only" />
                {{ opt.label }}
              </label>
            </div>
          </div>

          <!-- Sort -->
          <div>
            <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Sort</div>
            <div class="flex flex-wrap gap-1.5">
              <label
                v-for="[val, label] in ([['submitted','Submission order'],['challenge_first','Challenge first'],['tier_asc','Easiest first'],['tier_desc','Hardest first'],['list_position','List position']] as const)"
                :key="val"
                class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                :class="pendingSort === val
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
              >
                <input v-model="pendingSort" type="radio" :value="val" class="sr-only" />
                {{ label }}
              </label>
            </div>
          </div>

          <!-- Difficulty: All / Extreme / Non-extreme -->
          <div>
            <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Difficulty</div>
            <div class="flex flex-wrap gap-1.5">
              <label
                v-for="opt in (['all', 'extreme', 'non-extreme'] as const)"
                :key="opt"
                class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
                :class="difficultyFilter === opt
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
              >
                <input v-model="difficultyFilter" type="radio" :value="opt" class="sr-only" />
                {{ opt === 'all' ? 'All' : opt === 'extreme' ? 'Extreme' : 'Non-extreme' }}
              </label>
            </div>
          </div>

          <!-- Tier range -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Tier</span>
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
            <p class="text-[10px] text-zinc-600 mt-1">Submissions without a tier are hidden when the range is restricted.</p>
          </div>

          <!-- Tags -->
          <div>
            <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Tags</div>
            <div class="flex flex-wrap gap-1.5">
              <label
                v-for="t in PENDING_TAGS" :key="t"
                class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
                :class="pendingTagSet[t]
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
              >
                <input v-model="pendingTagSet[t]" type="checkbox" class="sr-only" />
                {{ t === 'uldm' ? 'ULDM' : t }}
              </label>
            </div>
          </div>

          <!-- Potential duplicates -->
          <div>
            <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Potential duplicates</div>
            <div class="flex flex-wrap gap-1.5">
              <label
                v-for="[val, label] in (
                  [['show', 'Show'], ['only', 'Only'], ['hide', 'Hide']] as const
                )"
                :key="val"
                class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors"
                :class="potentialDuplicateMode === val
                  ? (val === 'only' ? 'border-amber-400/60 text-amber-300 bg-amber-400/10'
                     : val === 'hide' ? 'border-zinc-500/60 text-zinc-200 bg-zinc-500/10'
                     : 'border-accent/60 text-accent bg-accent/10')
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
              >
                <input v-model="potentialDuplicateMode" type="radio" :value="val" class="sr-only" />
                {{ label }}
              </label>
            </div>
          </div>

          <div class="flex items-center justify-between pt-1">
            <button
              type="button"
              class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
              @click="resetFilters"
            >Reset filters</button>
          </div>
        </div>
      </div>
      <div ref="queueScroller" class="flex-1 min-h-0 overflow-y-auto">
        <ul v-if="filteredItems.length" class="p-1.5 space-y-1">
          <li v-for="r in windowedItems" :key="r.id">
            <button
              type="button"
              :data-pending-row="r.id"
              class="relative w-full overflow-hidden text-left px-2.5 py-2 text-sm rounded-lg transition-all group"
              :class="selectedId === r.id
                ? 'ring-2 ring-inset ring-accent bg-zinc-900 text-zinc-50'
                : 'ring-1 ring-inset ring-transparent text-zinc-300 hover:ring-zinc-700/60 hover:bg-zinc-900/60'"
              @click="selectedId = r.id"
            >
              <!-- Same level art the public list navs use, so a queue row and a
                   list row read as the same thing. -->
              <LevelThumbBg
                :gd-id="r.gd_id"
                :video-url="r.verification_url"
                res="small"
                :img-class="selectedId === r.id ? 'opacity-40' : 'opacity-[0.18] group-hover:opacity-35'"
                overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
              />

              <div class="relative font-medium truncate flex items-center gap-1.5">
                <!-- Ready or not, before anything is clicked. A queue of two
                     hundred imports is mostly incomplete rows, and finding the
                     ones worth opening meant opening all of them. -->
                <span
                  class="shrink-0 w-1.5 h-1.5 rounded-full"
                  :class="missingFields(r).length ? 'bg-amber-500/70' : 'bg-emerald-500'"
                  :title="missingFields(r).length ? `Needs ${missingFields(r).join(', ')}` : 'Has everything it needs'"
                />
                <span class="truncate drop-shadow-sm">{{ r.name ?? `Level ${r.gd_id}` }}</span>
                <span
                  v-if="r.from_open_verification_id"
                  class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-violet-900/60 text-violet-300 border border-violet-800/60"
                  title="Verification submitted for an open-verification level"
                >Verif</span>
                <span
                  v-if="r.from_void_level_id"
                  class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-800/60"
                  title="Submitted from the void list with a difficulty opinion"
                >Void</span>
                <span
                  v-if="r.potential_duplicate_position"
                  class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-900/60 text-amber-300 border border-amber-800/60"
                  :title="`Same name as ALL #${r.potential_duplicate_position} ${r.potential_duplicate_name}`"
                >Dupe?</span>
              </div>

              <div class="relative mt-1 flex items-center gap-1.5 text-[10px] flex-wrap">
                <span
                  v-if="r.gddl_tier"
                  class="shrink-0 px-1.5 py-px rounded font-semibold tabular-nums"
                  :style="{ backgroundColor: tierColor(r.gddl_tier), color: textOn(tierColor(r.gddl_tier)) }"
                  :title="r.gddl_tier_estimated ? 'Estimated from neighbouring shared levels' : r.gddl_tier"
                >{{ r.gddl_tier }}<span v-if="r.gddl_tier_estimated" class="ml-1 text-[8px] uppercase tracking-widest opacity-70">est</span></span>
                <span
                  v-if="r.difficulty === 'Extreme Demon'"
                  class="shrink-0 px-1.5 py-px rounded border border-red-900/60 bg-red-950/50 text-red-300"
                  title="Extreme Demon"
                >Extreme</span>
                <span
                  v-if="r.rated === 'Challenge'"
                  class="shrink-0 px-1.5 py-px rounded border border-yellow-800/60 bg-yellow-950/50 text-yellow-300"
                  title="Challenge"
                >Challenge</span>
                <span
                  v-if="r.placement_estimate != null"
                  class="shrink-0 px-1.5 py-px rounded border border-zinc-700 bg-zinc-900/80 text-zinc-400 tabular-nums"
                  :title="estimateTitle(r)"
                >~#{{ r.placement_estimate }}</span>
              </div>

              <div class="relative mt-1 text-[10px] text-zinc-500 truncate">
                <span class="tabular-nums">#{{ r.gd_id ?? '?' }}</span>
                <span class="text-zinc-700" aria-hidden="true"> · </span>
                <template v-if="r.from_gdl_id">GDL import</template>
                <template v-else-if="r.from_gdtpl_id">{{ (r.gdtpl_list_slug ?? 'list').toUpperCase() }} import</template>
                <template v-else-if="r.from_acs_id">ACS import</template>
                <template v-else-if="r.from_sheet_pending">Sheet pending<template v-if="r.placement_source"> · {{ r.placement_source }}</template></template>
                <template v-else>by {{ r.submitter ?? 'unknown' }}</template>
                <span class="text-zinc-700" aria-hidden="true"> · </span>
                <span :title="r.submitted_at">{{ relativeAge(r.submitted_at) }}</span>
              </div>
            </button>
          </li>
          <!-- The bottom of the drawn window; crossing it draws more. -->
          <li ref="queueSentinel" class="px-3 py-2 text-center text-[10px] text-zinc-600 tabular-nums">
            <span v-if="windowHasMore">{{ (filteredItems.length - windowedItems.length).toLocaleString() }} more below</span>
            <span v-else-if="filteredItems.length > WINDOW_STEP">end of the queue</span>
          </li>
        </ul>
        <div v-else-if="items.length" class="px-3 py-6 text-xs text-zinc-500 text-center">No matches in {{ items.length }} {{ isImported ? 'imported' : 'pending' }}.</div>
        <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">{{ isImported ? 'No imported levels to review.' : 'No pending submissions.' }}</div>
      </div>
    </aside>

    <!-- Center: submitted level details -->
    <section class="overflow-y-auto min-h-0 px-6 py-6">
      <div v-if="!selected" class="text-center text-sm text-zinc-500 py-12">
        {{ items.length === 0 ? 'No submissions to review.' : 'Pick a submission on the left.' }}
      </div>
      <div v-else class="max-w-2xl mx-auto space-y-5">
        <!-- Cover header: the level's own art, so a reviewer recognises what
             they're looking at before reading a single field. -->
        <header class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
          <LevelThumbBg
            :gd-id="selected.gd_id"
            :video-url="selected.verification_url"
            res="high"
            img-class="opacity-30"
            overlay-class="bg-gradient-to-r from-zinc-950 via-zinc-950/85 to-zinc-950/45"
          />
          <div class="relative p-4 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-2xl font-bold tracking-tight truncate text-zinc-50 drop-shadow">{{ selected.name ?? `Level ${selected.gd_id}` }}</h2>
              <p class="text-xs text-zinc-400 mt-1">
                <template v-if="selected.from_gdl_id">
                  Imported from GDL · {{ selected.submitted_at }}
                </template>
                <template v-else-if="selected.from_gdtpl_id">
                  Imported from {{ (selected.gdtpl_list_slug ?? 'list').toUpperCase() }}<template v-if="selected.gdtpl_position"> · placement #{{ selected.gdtpl_position }}</template> · {{ selected.submitted_at }}
                </template>
                <template v-else-if="selected.from_acs_id">
                  Imported from the ALL Challenges Sheet<template v-if="selected.acs_position"> · placement #{{ selected.acs_position }}</template> · {{ selected.submitted_at }}
                </template>
                <template v-else-if="selected.from_sheet_pending">
                  Imported from sheet pending list<template v-if="selected.placement_source"> · source: {{ selected.placement_source }}</template> · {{ selected.submitted_at }}
                </template>
                <template v-else>
                  Submitted by
                  <NuxtLink v-if="selected.submitter" :to="`/users/${selected.submitter}`" class="hover:text-accent">{{ selected.submitter }}</NuxtLink>
                  <span v-else>unknown</span>
                  · {{ selected.submitted_at }}
                </template>
              </p>
              <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  v-if="selected.gddl_tier || tierOverride"
                  class="rounded px-1.5 py-0.5 font-semibold tabular-nums"
                  :style="{
                    backgroundColor: tierColor(selected.gddl_tier || tierOverride),
                    color: textOn(tierColor(selected.gddl_tier || tierOverride)),
                  }"
                >{{ selected.gddl_tier || tierOverride }}</span>
                <span v-if="selected.difficulty" class="rounded px-1.5 py-0.5 bg-zinc-900/80 text-zinc-300 border border-zinc-800">{{ selected.difficulty }}</span>
                <a
                  v-if="gdLevelUrl(selected.gd_id)"
                  :href="gdLevelUrl(selected.gd_id)!"
                  target="_blank"
                  rel="noopener"
                  class="rounded px-1.5 py-0.5 bg-zinc-900/80 text-zinc-400 border border-zinc-800 hover:text-accent hover:border-accent/40 transition-colors tabular-nums"
                >ID {{ selected.gd_id }} ↗</a>
              </div>
            </div>
            <button
              v-if="!editing"
              type="button"
              class="shrink-0 rounded-lg border border-zinc-700 bg-zinc-950/70 hover:border-accent hover:text-accent text-xs px-3 py-1.5 transition-colors"
              @click="startEdit"
            >Edit</button>
          </div>
        </header>

        <!-- Inline edit form: same role as the Edit panel on the main-list
             LevelDetail. Updates pending_levels in place; closes on save. -->
        <section
          v-if="editing"
          class="rounded-md border border-accent/40 bg-zinc-950/80 p-4 space-y-3"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-xs uppercase tracking-widest text-accent font-medium">Editing submission</h3>
            <p v-if="editError" class="text-xs text-red-400">{{ editError }}</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="block sm:col-span-2 text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Name</span>
              <input v-model="editDraft.name" type="text" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Level ID</span>
              <input v-model="editDraft.gd_id" type="text" inputmode="numeric" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm tabular-nums focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Verifier</span>
              <input v-model="editDraft.verifier" type="text" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Verify date</span>
              <input v-model="editDraft.verify_date" type="date" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
              <input v-model="editDraft.gddl_tier" type="text" placeholder="e.g. Tier 25" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Difficulty</span>
              <input v-model="editDraft.difficulty" type="text" placeholder="e.g. Extreme Demon" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Rated</span>
              <input v-model="editDraft.rated" type="text" placeholder="Rated / Featured / Epic / Legendary / Mythic / Challenge" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Enjoyment</span>
              <input v-model="editDraft.enjoyment" type="number" step="0.1" min="0" max="10" inputmode="decimal" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm tabular-nums focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Main skillset</span>
              <input v-model="editDraft.main_skillset" type="text" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Source</span>
              <input v-model="editDraft.placement_source" type="text" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Verification title</span>
              <input v-model="editDraft.verification" type="text" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block text-xs">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500">Verification URL</span>
              <input v-model="editDraft.verification_url" type="url" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
          <label class="block text-xs">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500">Tags <span class="text-zinc-600 normal-case">comma-separated</span></span>
            <input v-model="editDraft.tags" type="text" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block text-xs">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500">Notes</span>
            <textarea v-model="editDraft.notes" rows="3" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <div class="flex items-center gap-2 pt-1">
            <button
              type="button"
              :disabled="editSaving"
              class="rounded bg-accent text-zinc-950 font-medium text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
              @click="saveEdit"
            >{{ editSaving ? 'Saving…' : 'Save' }}</button>
            <button
              type="button"
              :disabled="editSaving"
              class="rounded border border-zinc-700 hover:border-zinc-500 text-xs px-3 py-1.5 transition-colors"
              @click="cancelEdit"
            >Cancel</button>
          </div>
        </section>

        <div class="flex flex-wrap gap-2">
          <NuxtLink
            v-if="selected.potential_duplicate_position"
            :to="`/levels/${selected.potential_duplicate_position}`"
            class="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800/60 hover:bg-amber-900/60 hover:text-amber-200 transition-colors"
          >
            Potential Duplicate · #{{ selected.potential_duplicate_position }} {{ selected.potential_duplicate_name }}
          </NuxtLink>
          <span v-if="goesToVoid" class="inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-800/60">
            No difficulty opinion · will go to void
          </span>
          <NuxtLink
            v-if="selected.from_open_verification_id"
            :to="`/open-verifications/${selected.from_open_verification_id}`"
            target="_blank"
            class="inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-violet-900/40 text-violet-300 border border-violet-800/60 hover:bg-violet-900/60"
            title="Approving will remove the level from the open-verifications list"
          >
            Verification of open-verif #{{ selected.from_open_verification_id }} ↗
          </NuxtLink>
          <span
            v-if="selected.from_void_level_id"
            class="inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-800/60"
            title="Approving will remove the level from the void list"
          >
            From void list (ID {{ selected.from_void_level_id }}) — approval removes it from void
          </span>
        </div>

        <!-- What this submission still needs, then what it has. Six tiles of
             "—" told a reviewer nothing they could act on. -->
        <div
          v-if="selectedMissing.length"
          class="rounded-md border border-amber-900/50 bg-amber-950/20 px-4 py-3"
        >
          <h3 class="text-[10px] uppercase tracking-widest text-amber-300/90 font-medium">Still missing</h3>
          <p class="text-sm text-amber-100/90 mt-1">{{ selectedMissing.join(', ') }}</p>
          <p class="text-[11px] text-amber-200/50 mt-1">
            Fill them in with Edit above, or approve anyway if the list can carry it as it is.
          </p>
        </div>
        <div v-else class="rounded-md border border-emerald-900/50 bg-emerald-950/20 px-4 py-2.5">
          <p class="text-xs text-emerald-300/90">Everything the list needs is filled in.</p>
        </div>

        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div class="bg-zinc-950 p-3">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify date</dt>
            <dd class="text-sm" :class="selected.verify_date ? 'text-zinc-100' : 'text-amber-400/80'">
              {{ selected.verify_date ?? 'missing' }}
            </dd>
          </div>
          <div class="bg-zinc-950 p-3">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Tier</dt>
            <dd class="text-sm" :class="selected.gddl_tier || tierOverride ? 'text-zinc-100' : 'text-amber-400/80'">
              {{ selected.gddl_tier || tierOverride || 'missing' }}
              <span v-if="selected.gddl_tier && selected.gddl_tier_estimated" class="text-[10px] text-sky-300 ml-1">est.</span>
              <span v-else-if="!selected.gddl_tier && tierOverride" class="text-[10px] text-zinc-500 ml-1">auto</span>
            </dd>
          </div>
          <div class="bg-zinc-950 p-3">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Skillset</dt>
            <dd class="text-sm text-zinc-100">{{ selected.main_skillset ?? '—' }}</dd>
          </div>
          <div class="bg-zinc-950 p-3">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Enjoyment</dt>
            <dd class="text-sm text-zinc-100 tabular-nums">{{ selected.enjoyment != null ? Number(selected.enjoyment).toFixed(1) : '—' }}</dd>
          </div>
        </dl>

        <!-- Verification -->
        <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Verification</h3>
          <div v-if="verificationYtId" class="aspect-video bg-black mx-4 mt-3 rounded overflow-hidden border border-zinc-800">
            <iframe
              :src="`https://www.youtube.com/embed/${verificationYtId}`"
              class="w-full h-full"
              :title="selected.verification ?? 'Verification'"
              frameborder="0"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"
            />
          </div>
          <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-zinc-500">Verifier</dt><dd class="text-zinc-200">{{ selected.verifier ?? '—' }}</dd>
            <dt class="text-zinc-500">Title</dt><dd class="text-zinc-200">{{ selected.verification ?? '—' }}</dd>
            <dt class="text-zinc-500">Link</dt>
            <dd class="text-zinc-200 truncate">
              <a v-if="selected.verification_url" :href="selected.verification_url" target="_blank" rel="noopener" class="text-accent hover:underline break-all">{{ selected.verification_url }}</a>
              <span v-else class="text-zinc-600">—</span>
            </dd>
          </dl>
        </section>

        <section v-if="selected.tags" class="rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Tags</h3>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="t in selected.tags.split(',')" :key="t" class="text-[11px] px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 capitalize">
              {{ t === 'uldm' ? 'ULDM' : t }}
            </span>
          </div>
        </section>

        <section v-if="selected.notes" class="rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Notes from submitter</h3>
          <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ selected.notes }}</p>
        </section>
      </div>
    </section>

    <!-- Right: placement + actions -->
    <aside class="flex flex-col min-h-0 overflow-hidden border-l border-zinc-800 bg-zinc-950">
      <div v-if="selected" class="p-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
        <div>
          <div class="flex items-baseline justify-between mb-1">
            <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Placement</p>
            <button
              v-if="!goesToVoid"
              type="button"
              class="text-[10px] uppercase tracking-widest text-accent hover:bg-accent/10 px-1.5 py-0.5 rounded transition-colors"
              @click="placementHelperOpen = true"
              title="Open the full main-list browser to pick an anchor"
            >Placement helper</button>
          </div>
          <input
            v-model="placement"
            type="number" inputmode="numeric" min="1"
            placeholder="position #"
            :disabled="goesToVoid && false"
            class="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <p
              v-if="selected?.placement_estimate != null"
              class="text-[10px] text-accent"
            >
              <template v-if="isImported">Estimated</template>
              <template v-else>Submitter estimated</template>
              #{{ selected.placement_estimate.toLocaleString() }}<span v-if="selected.comparison_level_name"> (compared to {{ selected.comparison_level_name }})</span>.
            </p>
            <p v-if="placementSaved" class="text-[10px] text-emerald-400">Saved</p>
          </div>
          <!-- …and what that number means: the levels it would land between.
               A placement out of fifty thousand is only reviewable next to its
               neighbours. -->
          <p
            v-if="selected?.placement_estimate != null && (estimateNeighbours(selected).above || estimateNeighbours(selected).below)"
            class="text-[10px] text-zinc-500 mt-1 leading-snug"
          >
            <template v-if="estimateNeighbours(selected).above && estimateNeighbours(selected).below">Between</template>
            <template v-else-if="estimateNeighbours(selected).above">Just below</template>
            <template v-else>Just above</template>
            <template v-for="(n, i) in [estimateNeighbours(selected).above, estimateNeighbours(selected).below].filter(Boolean)" :key="i">
              <span v-if="i > 0" class="text-zinc-600"> and </span>
              <a
                v-if="n!.position"
                :href="`/levels/${n!.position}`"
                target="_blank"
                rel="noopener"
                class="text-zinc-300 hover:text-accent transition-colors"
              >{{ n!.name }}</a>
              <span v-else class="text-zinc-300">{{ n!.name }}</span>
              <span v-if="n!.position != null" class="text-zinc-600 tabular-nums"> #{{ n!.position.toLocaleString() }}</span>
            </template>
          </p>
          <p class="text-[10px] text-zinc-500 mt-1">
            <template v-if="goesToVoid">Position in the void list (no difficulty opinion).</template>
            <template v-else>Position in the main list. Existing levels at and below shift down by one.</template>
          </p>
        </div>

        <label v-if="!goesToVoid" class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">GDDL Tier <span class="text-zinc-600 normal-case">— auto-filled from level above</span></span>
          <input
            v-model="tierOverride"
            type="text"
            placeholder="e.g. Tier 15"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            @input="autoSaveTierDifficulty"
          />
        </label>

        <label v-if="!goesToVoid" class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty <span class="text-zinc-600 normal-case">— auto-filled from level above</span></span>
          <input
            v-model="difficultyOverride"
            type="text"
            placeholder="e.g. Extreme Demon"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            @input="autoSaveTierDifficulty"
          />
        </label>

        <!-- Flags: duplicate + alternate (collapsible, mirrors the edit-level form) -->
        <div class="rounded border border-zinc-800/80 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="flagsOpen"
            @click="flagsOpen = !flagsOpen"
          >
            <span>Flags
              <span v-if="isDuplicate || isAlternate || isTentative" class="normal-case tracking-normal text-accent ml-1">
                {{ [isDuplicate && 'Duplicate', isAlternate && 'Alternate', isTentative && 'Tentative'].filter(Boolean).join(', ') }}
              </span>
              <span v-if="flagsSaved" class="normal-case tracking-normal text-emerald-400 ml-1">Saved</span>
            </span>
            <svg :class="{ 'rotate-180': flagsOpen }" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="flagsOpen" class="px-3 pb-3 space-y-3">
            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none pt-1">
              <input v-model="isDuplicate" type="checkbox" class="mt-0.5 accent-accent" @change="autoSaveFlags" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Duplicate (same difficulty as above)</span>
                <span class="text-zinc-500 normal-case">— inherits the previous level's points.</span>
                <span v-if="selected.same_as_above" class="text-accent ml-1">Submitter requested this.</span>
              </span>
            </label>
            <div v-if="isDuplicate" class="pl-6">
              <span class="block text-[11px] uppercase tracking-widest text-zinc-500">Original level <span class="text-zinc-600 normal-case">makes the Duplicate tag link</span></span>
              <div class="mt-1 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                  @click="flagsDuplicatePickerOpen = true"
                >{{ draftDuplicateOf ? 'Change…' : 'Pick a level…' }}</button>
                <span v-if="draftDuplicateOf" class="text-xs text-zinc-200 truncate">#{{ draftDuplicateOf.position }} {{ draftDuplicateOf.name }}</span>
                <span v-else-if="duplicateOfId" class="text-xs text-zinc-500">DB ID {{ duplicateOfId }} — use picker to change</span>
                <button
                  v-if="draftDuplicateOf || duplicateOfId"
                  type="button"
                  class="text-[11px] text-zinc-500 hover:text-red-400"
                  @click="draftDuplicateOf = null; duplicateOfId = null; autoSaveFlags()"
                >clear</button>
              </div>
            </div>
            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input v-model="isAlternate" type="checkbox" class="mt-0.5 accent-accent" @change="autoSaveFlags" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Alternate</span>
                <span class="text-zinc-500 normal-case">— related variation; doesn't affect points.</span>
                <span v-if="selected.is_alternate" class="text-accent ml-1">Submitter requested this.</span>
              </span>
            </label>
            <div v-if="isAlternate" class="pl-6">
              <span class="block text-[11px] uppercase tracking-widest text-zinc-500">Original level <span class="text-zinc-600 normal-case">makes the Alternate tag link</span></span>
              <div class="mt-1 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                  @click="flagsAlternatePickerOpen = true"
                >{{ draftAlternateOf ? 'Change…' : 'Pick a level…' }}</button>
                <span v-if="draftAlternateOf" class="text-xs text-zinc-200 truncate">#{{ draftAlternateOf.position }} {{ draftAlternateOf.name }}</span>
                <span v-else-if="alternateOfId" class="text-xs text-zinc-500">DB ID {{ alternateOfId }} — use picker to change</span>
                <button
                  v-if="draftAlternateOf || alternateOfId"
                  type="button"
                  class="text-[11px] text-zinc-500 hover:text-red-400"
                  @click="draftAlternateOf = null; alternateOfId = null; autoSaveFlags()"
                >clear</button>
              </div>
            </div>
            <label
              class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none"
              title="Levels that do not have concrete estimations, leaving their placement on the List somewhat inaccurate."
            >
              <input v-model="isTentative" type="checkbox" class="mt-0.5 accent-yellow-400" @change="autoSaveFlags" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Tentative placement</span>
                <span class="text-zinc-500 normal-case">— shown as a yellow tag when this level's position is uncertain.</span>
              </span>
            </label>
          </div>
        </div>

        <!-- Preview rows around the candidate placement -->
        <div v-if="!goesToVoid">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Around #{{ preview?.placement ?? '—' }}</p>
          <div v-if="previewLoading" class="text-xs text-zinc-500">loading…</div>
          <div v-else-if="!preview" class="text-xs text-zinc-600">Enter a position to see context.</div>
          <ul v-else class="rounded border border-zinc-800 divide-y divide-zinc-900 overflow-hidden">
            <li
              v-if="preview.featuredAbove"
              class="px-2 py-1 flex items-center gap-2 text-xs bg-zinc-900/60"
            >
              <span class="text-[9px] uppercase tracking-widest text-zinc-500 shrink-0">Featured ↑</span>
              <span class="tabular-nums w-10 text-zinc-500">#{{ preview.featuredAbove.position }}</span>
              <span class="truncate flex-1 text-zinc-300">{{ preview.featuredAbove.name }}</span>
            </li>
            <li v-for="row in preview.above" :key="`a-${row.position}`" class="px-2 py-1 flex items-center gap-2 text-xs">
              <span class="tabular-nums w-10 text-zinc-500">#{{ row.position }}</span>
              <span class="truncate flex-1">{{ row.name }}</span>
            </li>
            <li class="px-2 py-1 flex items-center gap-2 text-xs bg-accent/15 text-accent">
              <span class="tabular-nums w-10 font-semibold">#{{ preview.placement }}</span>
              <span class="truncate flex-1 italic">← new submission</span>
            </li>
            <li v-for="row in preview.below" :key="`b-${row.position}`" class="px-2 py-1 flex items-center gap-2 text-xs">
              <span class="tabular-nums w-10 text-zinc-500">#{{ row.position + 1 }}</span>
              <span class="truncate flex-1">{{ row.name }}</span>
              <span class="text-[10px] text-zinc-600">(now #{{ row.position }})</span>
            </li>
            <li
              v-if="preview.featuredBelow"
              class="px-2 py-1 flex items-center gap-2 text-xs bg-zinc-900/60"
            >
              <span class="text-[9px] uppercase tracking-widest text-zinc-500 shrink-0">Featured ↓</span>
              <span class="tabular-nums w-10 text-zinc-500">#{{ preview.featuredBelow.position }}</span>
              <span class="truncate flex-1 text-zinc-300">{{ preview.featuredBelow.name }}</span>
            </li>
          </ul>
        </div>

        <!-- Reason / placement-suggestion inputs live at the END of the
             scroll area so the action footer below stays compact and visible
             on short viewports. -->
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Reason for denial <span class="text-zinc-600 normal-case">sent to submitter</span></span>
          <textarea
            v-model="rejectReason"
            rows="2"
            maxlength="4000"
            placeholder="Why this can't be accepted as-is."
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Placement suggestion <span class="text-zinc-600 normal-case">pre-fills awaiting tab</span></span>
          <input
            v-model="awaitPlacementSuggestion"
            type="number" inputmode="numeric" min="1"
            placeholder="position #"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>
      <!-- Sticky action footer: kept lean (just the buttons) so it fits in
           the column even on short viewports. -->
      <div v-if="selected" class="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2.5 flex flex-col gap-1.5">
        <button
          type="button"
          :disabled="decideLoading || !placement"
          class="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold text-xs py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          :title="placement ? undefined : 'Enter a position above first'"
          @click="decide('approve')"
        >{{ decideLoading ? 'Working…' : placement ? `Approve at #${placement}` : 'Approve — needs a position' }}</button>
        <div class="flex gap-1.5">
          <button
            type="button"
            :disabled="decideLoading"
            class="flex-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-zinc-50 font-medium text-xs py-2 transition-colors disabled:opacity-60"
            @click="decide('await')"
            title="Approve without a position. Goes to the public awaiting-placement list."
          >Awaiting</button>
          <button
            type="button"
            :disabled="decideLoading"
            class="flex-1 rounded-lg border border-zinc-700 hover:border-red-600 hover:text-red-400 text-xs py-2 transition-colors disabled:opacity-60"
            @click="decide('reject')"
          >Reject</button>
        </div>
        <div
          v-if="banner"
          class="rounded border px-2 py-1 text-[11px]"
          :class="banner.kind === 'ok' ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300' : 'border-red-900/50 bg-red-950/30 text-red-300'"
        >{{ banner.msg }}</div>
      </div>
      <div v-if="!selected" class="p-4">
        <p class="text-xs text-zinc-500">Select a submission to review.</p>
      </div>
    </aside>

    <LevelComparisonDrawer
      v-model:open="placementHelperOpen"
      :confirm-on-pick="true"
      title="Placement helper"
      hint="Click a level to set placement to right below it."
      @confirm="onPlacementHelperPick"
    />
    <LevelComparisonDrawer
      v-model:open="flagsDuplicatePickerOpen"
      :confirm-on-pick="true"
      title="Pick original (duplicate)"
      hint="Click the level this one is a duplicate of."
      @confirm="onFlagsDuplicatePick"
    />
    <LevelComparisonDrawer
      v-model:open="flagsAlternatePickerOpen"
      :confirm-on-pick="true"
      title="Pick original (alternate)"
      hint="Click the level this one is an alternate of."
      @confirm="onFlagsAlternatePick"
    />
  </div>
</template>

<style scoped>
/* Dual-handle range slider — mirrors LevelListNav.vue. Both inputs share the
   track and only their thumbs receive pointer events. */
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

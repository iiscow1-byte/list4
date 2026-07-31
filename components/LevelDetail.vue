<script setup lang="ts">
import { isChallengeSource } from '~/utils/challenge-sources'

type Community = {
  count: number
  community_tier: string | null
  community_enjoyment: number | null
  distribution: Record<string, number> | null
}
type Level = {
  /** levels.id — stable across renumbering; used as the comment target. */
  id?: number
  position: number
  /** Placement as printed in the source sheet — what the UI shows as "#N". */
  sheet_placement?: number | null
  name: string
  gd_id: number | null
  gddl_tier: string | null
  gddl_tier_frac?: number | null
  rated: string | null
  difficulty: string | null
  placement_source: string | null
  points: number | null
  main_skillset: string | null
  verify_date: string | null
  verification: string | null
  verification_url: string | null
  pov_placement: number | null
  year_verified: number | null
  source_tab: string | null
  permanent?: number | null
  creator?: string | null
  verifier?: string | null
  publisher?: string | null
  enjoyment?: number | null
  edel_enjoyment?: number | null
  aredl_position?: number | null
  aredl_tags?: string[] | null
  other_lists?: OtherListEntry[]
  description_override?: string | null
  same_as_above?: number | null
  duplicate_of_id?: number | null
  is_alternate?: number | null
  alternate_of_id?: number | null
  tentative_placement?: number | null
  duplicate_of?: { position: number; name: string } | null
  alternate_of?: { position: number; name: string } | null
  submitter?: string | null
  community?: Community | null
  position_history?: PositionHistoryEntry[]
  aredl_history?: AredlHistoryEntry[]
  challenge_rank?: number | null
}
type OtherListEntry = { list: string; position: number; url?: string | null }
type PositionHistoryEntry = {
  id: number
  from_position: number | null
  to_position: number
  changed_at: string
  changed_by: string | null
  source?: string
  raw_from_position?: number | null
  raw_to_position?: number | null
}
type AredlHistoryEntry = {
  event: string
  aredl_position: number | null
  all_position: number | null
  position_diff: number | null
  legacy: number
  cause_name: string | null
  action_at: string
}

type NavLevel = { position: number; name: string; gddl_tier: string | null; difficulty: string | null; gd_id?: number | null }
const props = defineProps<{
  level: Level
  readonly?: boolean
  moveBelowPick?: NavLevel | null
  groupMovePicks?: NavLevel[]
  groupMoveTargetPick?: NavLevel | null
  groupMovePhase?: 'select' | 'target'
}>()
const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'start-move-below'): void
  (e: 'end-move-below'): void
  (e: 'start-group-move'): void
  (e: 'continue-group-move'): void
  (e: 'back-group-move'): void
  (e: 'end-group-move'): void
}>()

const { data: meRes } = useCurrentUser()
const role = computed(() => meRes.value?.account?.role ?? null)
const isLoggedIn = computed(() => !!meRes.value?.account)
const isAdminLevel = computed(() => role.value === 'admin' || role.value === 'owner' || role.value === 'developer')
const canPromote = computed(() => isAdminLevel.value && !props.readonly)
const canEdit = computed(() => (isAdminLevel.value || role.value === 'moderator') && !props.readonly)
const canSubmitRecord = computed(() => isLoggedIn.value && !props.readonly)
const isPermanent = computed(() => !!props.level.permanent)

const showTierDecimal = useTierDecimal()
const TIER_MAX_ORD = 44 // Subtier 0-5 → 0-5; Tier 1-39 → 6-44
const gddlTierLabel = computed((): string | null => {
  const tier = props.level.gddl_tier
  if (!tier) return null
  if (!showTierDecimal.value) return tier
  const frac = props.level.gddl_tier_frac
  const subtierM = tier.match(/^Subtier (\d+)$/)
  const tierM = tier.match(/^Tier (\d+)$/)
  const num = subtierM ? Number(subtierM[1]) : tierM ? Number(tierM[1]) : null
  if (num === null) return tier
  const ord = subtierM ? num : (5 + num)
  if (frac == null || ord >= TIER_MAX_ORD) return tier
  return `${subtierM ? 'Subtier ' : 'Tier '}${(num + frac).toFixed(2)}`
})

type Tag = { label: string; to?: string; title?: string }
const tags = computed<Tag[]>(() => {
  const list: Tag[] = []
  if (gddlTierLabel.value) list.push({ label: gddlTierLabel.value })
  if (props.level.difficulty) list.push({ label: props.level.difficulty })
  if (props.level.main_skillset) list.push({ label: props.level.main_skillset })
  // Use the source-overridden label so the chip stays consistent with the
  // Rated tile when a challenge-source forces the rating.
  const sourceForced = isChallengeSource(props.level.placement_source)
  if (sourceForced) list.push({ label: 'Challenge' })
  else if (props.level.rated) list.push({ label: props.level.rated })
  if (props.level.placement_source) list.push({ label: props.level.placement_source })
  if (props.level.same_as_above) {
    const dup = props.level.duplicate_of
    list.push({
      label: 'Duplicate',
      to: dup ? `/levels/${dup.position}` : undefined,
      title: dup ? `Duplicate of #${dup.position} ${dup.name}` : undefined,
    })
  }
  if (props.level.is_alternate) {
    const alt = props.level.alternate_of
    list.push({
      label: 'Alternate',
      to: alt ? `/levels/${alt.position}` : undefined,
      title: alt ? `Alternate of #${alt.position} ${alt.name}` : undefined,
    })
  }
  // Merge Aredl tags after the local ones, case-insensitively deduped against
  // anything we already added so we don't repeat the rated/difficulty chips.
  const seen = new Set(list.map((t) => t.label.toLowerCase()))
  for (const t of props.level.aredl_tags ?? []) {
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ label: t })
  }
  return list
})

/** Pull a YouTube video ID from any of the URL forms YouTube uses. */
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

const ytId = computed(() => youtubeId(props.level.verification_url))

// Autofill verify_date from the YouTube upload date when a level has a
// verification link but no date yet — mirrors the submit page. Mods/admins
// only (the PATCH endpoint requires it). Reloads the page so the new date
// shows in the stat tile.
const verifyDateAutofilling = ref(false)
watch(() => props.level.position, () => {
  if (verifyDateAutofilling.value) return
  if (!canEdit.value) return
  if (props.level.verify_date) return
  const id = ytId.value
  if (!id) return
  verifyDateAutofilling.value = true
  ;(async () => {
    try {
      const res = await $fetch<{ date: string | null }>(`/api/youtube/upload-date?id=${id}`)
      const date = res?.date
      if (!date) return
      await $fetch(`/api/admin/levels/${props.level.position}`, {
        method: 'PATCH', body: { verify_date: date },
      })
      // Soft refresh any useFetch/useAsyncData on the surrounding page so the
      // new verify_date renders in the stat tile.
      await refreshNuxtData()
    } catch { /* ignore — admin can edit later */ } finally {
      verifyDateAutofilling.value = false
    }
  })()
}, { immediate: true })
const fallbackSearch = computed(() => {
  if (!props.level.verification) return null
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(props.level.verification)}`
})

const gdLevelUrl = computed(() => {
  if (!props.level.gd_id) return null
  return `https://gdbrowser.com/${props.level.gd_id}`
})

const gdIdCopied = ref(false)
let gdIdCopyTimer: ReturnType<typeof setTimeout> | null = null
function copyGdId() {
  if (!props.level.gd_id) return
  navigator.clipboard.writeText(String(props.level.gd_id)).then(() => {
    gdIdCopied.value = true
    if (gdIdCopyTimer) clearTimeout(gdIdCopyTimer)
    gdIdCopyTimer = setTimeout(() => { gdIdCopied.value = false }, 1500)
  }).catch(() => {})
}

/**
 * The number the site shows for a placement. `position` stays the internal
 * ordering + URL key; the sheet's own placement is what readers recognise.
 */
const shownPlacement = computed(() => props.level.sheet_placement ?? props.level.position)

/** Drag-to-place dialog (admins only). */
const placementEditorOpen = ref(false)

function formatPoints(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toFixed(2)
}

// --- Promote (temp → permanent) ---
const promoting = ref(false)
const promoteError = ref<string | null>(null)
async function promote() {
  if (promoting.value) return

  promoting.value = true
  promoteError.value = null
  try {
    await $fetch(`/api/admin/levels/${props.level.position}/promote`, { method: 'POST' })
    emit('refresh')
  } catch (e: any) {
    promoteError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.'
  } finally {
    promoting.value = false
  }
}

// --- Edit ---
type EditableFields = Pick<Level,
  'name' | 'gd_id' | 'creator' | 'verifier' | 'publisher' | 'enjoyment' |
  'difficulty' | 'gddl_tier' | 'rated' | 'placement_source' | 'main_skillset' |
  'verification' | 'verification_url' | 'year_verified' |
  'description_override'
> & {
  same_as_above: boolean
  duplicate_of_id: number | null
  is_alternate: boolean
  alternate_of_id: number | null
  tentative_placement: boolean
}
const editing = ref(false)
const apiOverridesOpen = ref(false)
const sourcesOpen = ref(false)
const gameplayOpen = ref(false)
const creditsOpen = ref(false)
const verificationOpen = ref(false)
const flagsOpen = ref(false)
const draft = reactive<Record<keyof EditableFields, any>>({
  name: '',
  gd_id: '',
  creator: '',
  verifier: '',
  publisher: '',
  enjoyment: '',
  difficulty: '',
  gddl_tier: '',
  rated: '',
  placement_source: '',
  main_skillset: '',
  verification: '',
  verification_url: '',
  year_verified: '',
  description_override: '',
  same_as_above: false,
  duplicate_of_id: null,
  is_alternate: false,
  alternate_of_id: null,
  tentative_placement: false,
})
// Multiple placement sources: admins can tag a level with several source lists.
// Stored as pipe-separated in placement_source; managed as an array here.
const availableSources = ref<string[]>([])
const selectedSources = ref<string[]>([])
watch(selectedSources, (arr) => { draft.placement_source = arr.join('|') }, { deep: true })

function toggleSource(src: string) {
  const idx = selectedSources.value.indexOf(src)
  if (idx >= 0) selectedSources.value.splice(idx, 1)
  else selectedSources.value.push(src)
}

// Display-side cache of the picked originals, so the edit panel can show
// "#42 Foo" without an extra fetch. Pre-populated from props on edit start.
const draftDuplicateOf = ref<{ position: number; name: string } | null>(null)
const draftAlternateOf = ref<{ position: number; name: string } | null>(null)
const editDuplicatePickerOpen = ref(false)
const editAlternatePickerOpen = ref(false)
const draftPosition = ref<number | string>('')
const saving = ref(false)
const saveError = ref<string | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function startEdit() {
  draft.name = props.level.name ?? ''
  draft.gd_id = props.level.gd_id ?? ''
  draft.creator = props.level.creator ?? ''
  draft.verifier = props.level.verifier ?? ''
  draft.publisher = props.level.publisher ?? ''
  draft.enjoyment = props.level.enjoyment ?? ''
  draft.difficulty = props.level.difficulty ?? ''
  draft.gddl_tier = props.level.gddl_tier ?? ''
  draft.rated = props.level.rated ?? ''
  draft.placement_source = props.level.placement_source ?? ''
  draft.main_skillset = props.level.main_skillset ?? ''
  draft.verification = props.level.verification ?? ''
  draft.verification_url = props.level.verification_url ?? ''
  draft.year_verified = props.level.year_verified ?? ''
  draft.description_override = props.level.description_override ?? ''
  draft.same_as_above = !!props.level.same_as_above
  draft.duplicate_of_id = props.level.duplicate_of_id ?? null
  draft.is_alternate = !!props.level.is_alternate
  draft.alternate_of_id = props.level.alternate_of_id ?? null
  draft.tentative_placement = !!props.level.tentative_placement
  draftDuplicateOf.value = props.level.duplicate_of ?? null
  draftAlternateOf.value = props.level.alternate_of ?? null
  draftPosition.value = props.level.position
  saveError.value = null
  deleteError.value = null
  apiOverridesOpen.value = false
  gameplayOpen.value = false
  creditsOpen.value = false
  verificationOpen.value = false
  flagsOpen.value = false
  // Init sources: parse existing pipe-separated value
  selectedSources.value = (props.level.placement_source ?? '').split('|').map((s) => s.trim()).filter(Boolean)
  // Load available sources in the background (don't block edit opening)
  $fetch<{ sources: { source: string; count: number }[] }>('/api/levels/sources').then((res) => {
    const known = res.sources.map((s) => s.source)
    // Ensure current selections appear even if not in the fetched list
    const all = [...new Set([...known, ...selectedSources.value])]
    availableSources.value = all
  }).catch(() => {
    availableSources.value = [...selectedSources.value]
  })
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  saveError.value = null
  deleteError.value = null
  stopMoveBelow()
}

// Switching to a different level should drop any unsaved edit state — the
// same component instance is reused across navigation in this layout.
watch(() => props.level.position, (next, prev) => {
  if (prev != null && next !== prev) cancelEdit()
})

// --- GD info dropdown ---
type GdInfo = {
  id: number
  name: string | null
  author: string | null
  description: string | null
  downloads: number
  likes: number
  length: string | null
  objects: number
  objectsApprox: boolean
  coins: number
  verifiedCoins: boolean
  score: 0 | 1 | 2 | 3 | 4 | 5
  song: { name: string | null; id: number | null; custom: boolean }
  password: string | null
}
const SCORE_LABELS = ['Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'] as const
const isChallengeTier = computed(
  () => !!props.level.gddl_tier && /^Tier \d+$/.test(props.level.gddl_tier),
)
const ratedLabel = computed(() => {
  // Source-driven Challenge override: certain placement_source values pin the
  // rating to Challenge regardless of what the GD API or `rated` column says.
  if (isChallengeSource(props.level.placement_source)) return 'Challenge'
  if (props.level.rated === 'Challenge') return 'Challenge'
  if (!infoData.value) return null
  const { score, length } = infoData.value
  if (score === 0 && (length === 'Tiny' || length === 'Short') && isChallengeTier.value) {
    return 'Challenge'
  }
  return SCORE_LABELS[score]
})

const displayedDifficulty = computed(() => {
  if (!props.level.difficulty) return null
  if (props.level.challenge_rank != null) return props.level.difficulty.replace(/Demon/i, 'Challenge')
  return props.level.difficulty
})
const infoOpen = ref(false)
const infoData = ref<GdInfo | null>(null)
const infoLoading = ref(false)
const infoError = ref<string | null>(null)
const infoBtn = ref<HTMLElement | null>(null)
const infoPanel = ref<HTMLElement | null>(null)
const lastFetchedId = ref<number | null>(null)
const actionsOpen = ref(false)
const actionsMenuRef = ref<HTMLElement | null>(null)

async function loadInfo() {
  const id = props.level.gd_id
  if (!id) return
  if (lastFetchedId.value === id && infoData.value) return
  infoLoading.value = true
  infoError.value = null
  try {
    const data = await $fetch<GdInfo>(`/api/gd/level/${id}`)
    if (props.level.gd_id !== id) return
    infoData.value = data
    lastFetchedId.value = id
  } catch (e: any) {
    if (props.level.gd_id !== id) return
    infoError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to load.'
  } finally {
    if (props.level.gd_id === id) infoLoading.value = false
  }
}

async function toggleInfo() {
  infoOpen.value = !infoOpen.value
  if (infoOpen.value) await loadInfo()
}

watch(() => props.level.gd_id, (id) => {
  infoOpen.value = false
  infoData.value = null
  lastFetchedId.value = null
  infoError.value = null
  if (id) loadInfo()
}, { immediate: true })

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (infoOpen.value && !infoPanel.value?.contains(t) && !infoBtn.value?.contains(t)) infoOpen.value = false
  if (actionsOpen.value && !actionsMenuRef.value?.contains(t)) actionsOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { infoOpen.value = false; actionsOpen.value = false }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

function fmtNum(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString()
}

// Publisher: prefer the manually-set field, fall back to the GD account that
// posted the level (resolved by gdbrowser into a username).
const apiPublisher = computed(() => infoData.value?.author ?? null)
const resolvedPublisher = computed<string | null>(
  () => props.level.publisher ?? apiPublisher.value ?? null,
)

type CreditRow = { label: string; value: string }
const creditRows = computed<CreditRow[]>(() => {
  const rows: CreditRow[] = []
  if (props.level.creator)         rows.push({ label: 'Creator(s)', value: props.level.creator })
  if (props.level.verifier)        rows.push({ label: 'Verifier',   value: props.level.verifier })
  if (resolvedPublisher.value)     rows.push({ label: 'Publisher',  value: resolvedPublisher.value })
  return rows
})

const infoRows = computed<CreditRow[]>(() => {
  const rows: CreditRow[] = []
  if (props.level.placement_source) rows.push({ label: 'Source list',   value: props.level.placement_source })
  if (props.level.verification)     rows.push({ label: 'Verification',  value: props.level.verification })
  if (props.level.year_verified)    rows.push({ label: 'Year verified', value: String(props.level.year_verified) })
  if (props.level.submitter)        rows.push({ label: 'Submitted by',  value: props.level.submitter })
  return rows
})

// Stat tiles: rendered only when populated. Two grids preserved from the
// original layout — the first is identity/scoring, the second is gameplay
// metadata. The grid-cols class is picked based on visible-tile count so
// hidden tiles don't leave gray gap-px slots showing through.
type Tile1 = 'level_id' | 'list_points' | 'enjoyment' | 'edel_enjoyment' | 'gddl_tier' | 'verify_date'
type Tile2 = 'difficulty' | 'rated' | 'main_skillset' | 'pov_placement' | 'community_tier'

const community = computed<Community | null>(() => props.level.community ?? null)
const hasCommunityTier = computed(() => !!community.value?.community_tier)
const hasDistribution = computed(() => !!community.value?.distribution)

const visibleTiles1 = computed<Tile1[]>(() => {
  const out: Tile1[] = []
  if (props.level.gd_id)                    out.push('level_id')
  if (props.level.points != null)           out.push('list_points')
  if (props.level.enjoyment != null)        out.push('enjoyment')
  if (props.level.edel_enjoyment != null)   out.push('edel_enjoyment')
  if (props.level.gddl_tier)                out.push('gddl_tier')
  if (props.level.verify_date)              out.push('verify_date')
  return out
})

const visibleTiles2 = computed<Tile2[]>(() => {
  const out: Tile2[] = []
  if (props.level.difficulty)         out.push('difficulty')
  if (ratedLabel.value)               out.push('rated')
  if (props.level.main_skillset)      out.push('main_skillset')
  if (props.level.pov_placement != null) out.push('pov_placement')
  if (hasCommunityTier.value)         out.push('community_tier')
  return out
})

// --- Community distribution popover (bar chart) ---
const distOpen = ref(false)
const distBtn = ref<HTMLElement | null>(null)
const distPanel = ref<HTMLElement | null>(null)

function toggleDist() { distOpen.value = !distOpen.value }
function onDistDocClick(e: MouseEvent) {
  if (!distOpen.value) return
  const t = e.target as Node
  if (distPanel.value?.contains(t) || distBtn.value?.contains(t)) return
  distOpen.value = false
}
function onDistKey(e: KeyboardEvent) {
  if (e.key === 'Escape') distOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', onDistDocClick)
  document.addEventListener('keydown', onDistKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDistDocClick)
  document.removeEventListener('keydown', onDistKey)
})

/** Sorted [label, count] pairs for the bar chart. Subtiers ascending, then
 * Tiers ascending; unrecognized keys fall to the bottom. */
function tierKeyOrder(label: string): number {
  if (label === '—') return 1e9
  const m = label.match(/^(Tier|Subtier) (\d{1,2})$/)
  if (!m) return 9e8
  const n = Number(m[2])
  return m[1] === 'Subtier' ? n : 100 + n
}
const distRows = computed<{ label: string; count: number; pct: number }[]>(() => {
  const dist = community.value?.distribution
  if (!dist) return []
  const entries = Object.entries(dist).map(([label, count]) => ({ label, count }))
  entries.sort((a, b) => tierKeyOrder(a.label) - tierKeyOrder(b.label))
  const max = Math.max(1, ...entries.map((e) => e.count))
  return entries.map((e) => ({ ...e, pct: (e.count / max) * 100 }))
})

// Tailwind needs literal class names in source — enumerate up to 5.
function gridColsClass(n: number): string {
  switch (n) {
    case 1: return 'grid-cols-1'
    case 2: return 'grid-cols-2'
    case 3: return 'grid-cols-2 sm:grid-cols-3'
    case 4: return 'grid-cols-2 sm:grid-cols-4'
    case 5: return 'grid-cols-2 sm:grid-cols-5'
    default: return 'grid-cols-2 sm:grid-cols-4'
  }
}

async function saveEdit() {
  if (saving.value) return
  saving.value = true
  saveError.value = null
  try {
    // Clear the linked-original ids if their toggle is off — stops stale ids
    // from sticking around after the user un-toggles Duplicate / Alternate.
    const payload: Record<string, unknown> = { ...draft }
    if (!draft.same_as_above) payload.duplicate_of_id = null
    if (!draft.is_alternate)  payload.alternate_of_id = null
    await $fetch(`/api/admin/levels/${props.level.position}`, { method: 'PATCH', body: payload })
    // If position changed, do the structural move after the metadata save —
    // it shifts neighboring rows so it's a separate atomic op.
    const newPos = Number(draftPosition.value)
    if (Number.isInteger(newPos) && newPos > 0 && newPos !== props.level.position) {
      await $fetch(`/api/admin/levels/${props.level.position}/move`, { method: 'POST', body: { to: newPos } })
      // The current URL still references the old position; navigate to the new one.
      await navigateTo(`/levels/${newPos}`)
      return
    }
    emit('refresh')
    editing.value = false
    stopMoveBelow()
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Save failed.'
  } finally {
    saving.value = false
  }
}

// Move-below: clicking a level in the left nav (via parent mediation) sets the
// draft position to place this level immediately below the clicked one.
const moveBelowActive = ref(false)
const pendingMoveReady = ref(false)
const pendingMoveSubmitting = ref(false)
const pendingMoveNotes = ref('')
const pendingMoveSuccess = ref(false)
const pendingMoveError = ref<string | null>(null)

// Group move: two-phase — first select levels, then pick a target level to
// place the group below. Admins only.
const groupMoveActive = ref(false)
const groupMoveSubmitting = ref(false)
const groupMoveError = ref<string | null>(null)

// Computed delta from the target pick: group leader (min position) lands just
// below the clicked level, same logic as single-level move-below.
const groupMoveDelta = computed<number | null>(() => {
  if (!props.groupMoveTargetPick || !props.groupMovePicks?.length) return null
  const minGroupPos = Math.min(...props.groupMovePicks.map((p) => p.position))
  const t = props.groupMoveTargetPick.position
  const targetPos = t < minGroupPos ? t + 1 : t
  return targetPos - minGroupPos
})

function startGroupMove() {
  groupMoveActive.value = true
  groupMoveError.value = null
  actionsOpen.value = false
  if (moveBelowActive.value) {
    moveBelowActive.value = false
    emit('end-move-below')
  }
  emit('start-group-move')
}
function continueGroupMove() {
  groupMoveError.value = null
  emit('continue-group-move')
}
function backGroupMove() {
  groupMoveError.value = null
  emit('back-group-move')
}
function stopGroupMove() {
  groupMoveActive.value = false
  groupMoveError.value = null
  emit('end-group-move')
}

async function submitGroupMove() {
  if (groupMoveSubmitting.value) return
  if (!props.groupMovePicks?.length || groupMoveDelta.value == null) return
  groupMoveSubmitting.value = true
  groupMoveError.value = null
  try {
    await $fetch('/api/admin/levels/group-move', {
      method: 'POST',
      body: { positions: props.groupMovePicks.map((p) => p.position), delta: groupMoveDelta.value },
    })
    emit('refresh')
    stopGroupMove()
  } catch (e: any) {
    groupMoveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Group move failed.'
  } finally {
    groupMoveSubmitting.value = false
  }
}

async function submitGroupMoveRequest() {
  if (groupMoveSubmitting.value) return
  if (!props.groupMovePicks?.length || groupMoveDelta.value == null) return
  groupMoveSubmitting.value = true
  groupMoveError.value = null
  try {
    await $fetch('/api/admin/levels/group-move-request', {
      method: 'POST',
      body: { positions: props.groupMovePicks.map((p) => p.position), delta: groupMoveDelta.value },
    })
    stopGroupMove()
  } catch (e: any) {
    groupMoveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to submit requests.'
  } finally {
    groupMoveSubmitting.value = false
  }
}

function startMoveBelow() {
  moveBelowActive.value = true
  pendingMoveReady.value = false
  emit('start-move-below')
}
function stopMoveBelow() {
  moveBelowActive.value = false
  emit('end-move-below')
}

watch(() => props.level.position, () => {
  pendingMoveReady.value = false
  pendingMoveSubmitting.value = false
  pendingMoveNotes.value = ''
  pendingMoveSuccess.value = false
  pendingMoveError.value = null
  if (moveBelowActive.value) {
    moveBelowActive.value = false
    emit('end-move-below')
  }
  if (groupMoveActive.value) stopGroupMove()
})

watch(() => props.moveBelowPick, (picked) => {
  if (!picked) return
  const cur = props.level.position
  if (picked.position === cur) return
  // Direction-aware: place this level right below the picked one.
  const target = picked.position < cur ? picked.position + 1 : picked.position
  draftPosition.value = target
  if (picked.gddl_tier) draft.gddl_tier = picked.gddl_tier
  if (picked.difficulty) draft.difficulty = picked.difficulty
  pendingMoveReady.value = true
  pendingMoveSuccess.value = false
  pendingMoveError.value = null
  stopMoveBelow()
})

async function submitPendingMove() {
  if (pendingMoveSubmitting.value) return
  const toPos = Number(draftPosition.value)
  if (!Number.isInteger(toPos) || toPos <= 0 || toPos === props.level.position) return
  pendingMoveSubmitting.value = true
  pendingMoveError.value = null
  try {
    await $fetch('/api/movements', {
      method: 'POST',
      body: {
        level_name: props.level.name,
        level_gd_id: props.level.gd_id ?? null,
        from_position: props.level.position,
        to_position: toPos,
        notes: pendingMoveNotes.value.trim() || null,
      },
    })
    pendingMoveSuccess.value = true
    pendingMoveReady.value = false
    pendingMoveNotes.value = ''
  } catch (e: any) {
    pendingMoveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to submit.'
  } finally {
    pendingMoveSubmitting.value = false
  }
}

async function deleteLevel() {
  if (deleting.value) return
  if (!confirm(`Delete "${props.level.name}" (#${props.level.position})? This shifts everything below up by one and cannot be undone from the UI.`)) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/admin/levels/${props.level.position}`, { method: 'DELETE' })
    await navigateTo('/levels/1')
  } catch (e: any) {
    deleteError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Delete failed.'
  } finally {
    deleting.value = false
  }
}

const sendingToAwaiting = ref(false)
const sendToAwaitingError = ref<string | null>(null)
async function sendToAwaiting() {
  if (sendingToAwaiting.value) return
  if (!confirm(`Send "${props.level.name}" (#${props.level.position}) back to the Awaiting Placement list? This removes it from the main list and shifts everything below up by one.`)) return
  sendingToAwaiting.value = true
  sendToAwaitingError.value = null
  try {
    await $fetch(`/api/admin/levels/${props.level.position}/to-awaiting`, { method: 'POST' })
    await navigateTo('/awaiting')
  } catch (e: any) {
    sendToAwaitingError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.'
  } finally {
    sendingToAwaiting.value = false
  }
}

// Estimated placement for levels not on any external list
const isExtremeLevel = computed(() =>
  !!props.level.difficulty?.toLowerCase().includes('extreme')
)

// True for any level that appears in the challenge tab (rated=Challenge, isChallengeSource, or short/tiny+score=0).
// The server already computes challenge_rank using the full IS_CHALLENGE_L expression.
const isChallengeLevel = computed(() => props.level.challenge_rank != null)

// GDL/AREDL placements are suppressed for non-extreme levels; CL is suppressed for non-challenge levels.
const visibleOtherLists = computed(() => {
  const lists = props.level.other_lists ?? []
  return lists.filter((e) => {
    if (e.list === 'GDL' || e.list === 'AREDL') return isExtremeLevel.value
    return true
  })
})

type EstimatedPlacement = {
  estimated_aredl: number | null
  bracket: {
    above: { position: number; name: string; aredl_position: number } | null
    below: { position: number; name: string; aredl_position: number } | null
  }
}
const estimatedData = ref<EstimatedPlacement | null>(null)
const estimatedLoading = ref(false)
const estimatedFetched = ref(false)

type EstimatedGdlPlacement = {
  estimated_gdl: number | null
  bracket: {
    above: { position: number; name: string; gdl_position: number } | null
    below: { position: number; name: string; gdl_position: number } | null
  }
}
const gdlEstimatedData = ref<EstimatedGdlPlacement | null>(null)
const gdlEstimatedLoading = ref(false)
const gdlEstimatedFetched = ref(false)

type EstimatedClPlacement = {
  estimated_cl: number | null
  bracket: {
    above: { position: number; name: string; challenge_list_position: number } | null
    below: { position: number; name: string; challenge_list_position: number } | null
  }
}
const clEstimatedData = ref<EstimatedClPlacement | null>(null)
const clEstimatedLoading = ref(false)
const clEstimatedFetched = ref(false)

function fetchAredlEstimate() {
  if (!isExtremeLevel.value) return
  if (props.level.other_lists?.some((e) => e.list === 'AREDL')) return
  if (estimatedFetched.value) return
  estimatedLoading.value = true
  $fetch<EstimatedPlacement>(`/api/levels/${props.level.position}/estimated-placement`)
    .then((data) => { estimatedData.value = data; estimatedFetched.value = true })
    .catch(() => { estimatedData.value = null })
    .finally(() => { estimatedLoading.value = false })
}

function fetchGdlEstimate() {
  if (!isExtremeLevel.value) return
  if (props.level.other_lists?.some((e) => e.list === 'GDL')) return
  if (gdlEstimatedFetched.value) return
  gdlEstimatedLoading.value = true
  $fetch<EstimatedGdlPlacement>(`/api/levels/${props.level.position}/estimated-gdl-placement`)
    .then((data) => { gdlEstimatedData.value = data; gdlEstimatedFetched.value = true })
    .catch(() => { gdlEstimatedData.value = null })
    .finally(() => { gdlEstimatedLoading.value = false })
}

function fetchClEstimate() {
  if (!isChallengeLevel.value) return
  if (props.level.other_lists?.some((e) => e.list === 'Challenge List')) return
  if (clEstimatedFetched.value) return
  clEstimatedLoading.value = true
  $fetch<EstimatedClPlacement>(`/api/levels/${props.level.position}/estimated-cl-placement`)
    .then((data) => { clEstimatedData.value = data; clEstimatedFetched.value = true })
    .catch(() => { clEstimatedData.value = null })
    .finally(() => { clEstimatedLoading.value = false })
}

function onOtherListsToggle(e: Event) {
  onOtherListsOpenChange((e.target as HTMLDetailsElement).open)
}

function shouldOpenOtherLists(): boolean {
  return (props.level.other_lists?.length ?? 0) > 0 || isExtremeLevel.value || isChallengeLevel.value
}

// Stable open state — set once per level so Vue never re-opens the panel
// reactively (which causes scroll jumps). User toggles are preserved.
const otherListsOpen = ref(false)

function onOtherListsOpenChange(open: boolean) {
  otherListsOpen.value = open
  if (open) {
    fetchAredlEstimate()
    fetchGdlEstimate()
    fetchClEstimate()
  }
}

// Fetch all estimates on level load (covers pre-opened panel and SSR)
watch(() => props.level.position, () => {
  estimatedData.value = null
  estimatedFetched.value = false
  gdlEstimatedData.value = null
  gdlEstimatedFetched.value = false
  clEstimatedData.value = null
  clEstimatedFetched.value = false
  otherListsOpen.value = shouldOpenOtherLists()
  fetchAredlEstimate()
  fetchGdlEstimate()
  fetchClEstimate()
}, { immediate: true })

const deletingHistoryId = ref<number | null>(null)
async function deleteHistoryEntry(entryId: number) {
  if (deletingHistoryId.value != null) return
  deletingHistoryId.value = entryId
  try {
    await $fetch(`/api/admin/position-history/${entryId}`, { method: 'DELETE' })
    emit('refresh')
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Delete failed.'
  } finally {
    deletingHistoryId.value = null
  }
}

function formatHistoryDay(changedAt: string): string {
  const ymd = changedAt.slice(0, 10)
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

const historyByDay = computed(() => {
  const history = props.level.position_history
  if (!history?.length) return []
  const map = new Map<string, { date: string; label: string; entries: PositionHistoryEntry[] }>()
  for (const entry of history) {
    const date = entry.changed_at.slice(0, 10)
    if (!map.has(date)) map.set(date, { date, label: formatHistoryDay(entry.changed_at), entries: [] })
    map.get(date)!.entries.push(entry)
  }
  return [...map.values()]
})

// --- Placement graph series ---
// ALL line: the converted AREDL trace (fine-grained, includes passive shifts)
// plus native moves. AREDL self-moves in position_history are skipped here —
// they're already part of the trace. Ends at the current placement.
const chartAllSeries = computed(() => {
  const pts: { at: string; position: number }[] = []
  for (const e of props.level.aredl_history ?? []) {
    if (e.all_position != null) pts.push({ at: e.action_at, position: e.all_position })
  }
  for (const h of props.level.position_history ?? []) {
    if ((h.source ?? 'all') !== 'aredl') pts.push({ at: h.changed_at, position: h.to_position })
  }
  pts.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  pts.push({ at: new Date().toISOString(), position: props.level.position })
  return pts
})
const chartAredlSeries = computed(() =>
  (props.level.aredl_history ?? [])
    .filter((e) => e.aredl_position != null)
    .map((e) => ({ at: e.action_at, position: e.aredl_position! })),
)
</script>

<template>
  <div class="relative">
    <!-- Hero backdrop: the level's thumbnail fading into the page background -->
    <div class="absolute inset-x-0 top-0 h-[24rem] overflow-hidden pointer-events-none" aria-hidden="true">
      <LevelThumbBg
        :gd-id="level.gd_id"
        :video-url="level.verification_url"
        res="high"
        img-class="opacity-45 scale-105"
        overlay-class="bg-gradient-to-b from-zinc-950/20 via-zinc-950/70 to-zinc-950"
      />
    </div>

    <div class="relative px-8 py-8 max-w-3xl mx-auto w-full">
    <header class="mb-6 flex items-start gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-3 flex-wrap">
          <span class="tabular-nums text-accent text-base font-semibold drop-shadow">#{{ shownPlacement }}</span>
          <h1 class="text-3xl sm:text-4xl font-bold tracking-tight drop-shadow-lg">{{ level.name }}</h1>
        </div>
        <p v-if="level.placement_source || level.year_verified" class="text-xs text-zinc-500 mt-1.5">
          <span v-if="level.placement_source">Source: {{ level.placement_source }}</span>
        </p>
        <div v-if="level.challenge_rank != null" class="inline-flex items-center gap-2 mt-1.5 px-2.5 py-1 rounded-md bg-amber-950/30 border border-amber-900/40">
          <span class="text-[10px] uppercase tracking-widest text-amber-500/80 font-medium">Challenge</span>
          <span class="tabular-nums text-sm font-semibold text-amber-300">Ch. #{{ level.challenge_rank }}</span>
        </div>
        <div v-if="level.difficulty" class="flex items-center gap-3 mt-3">
          <DifficultyFace
            :difficulty="editing ? (draft.difficulty || level.difficulty) : level.difficulty"
            :rated="editing ? (draft.rated || null) : (ratedLabel ?? level.rated)"
            :position="editing ? (Number(draftPosition) || level.position) : level.position"
          />
          <div>
            <p class="text-sm font-medium text-zinc-200 capitalize">{{ displayedDifficulty }}</p>
            <p v-if="gddlTierLabel" class="text-xs text-zinc-400 mt-0.5">{{ gddlTierLabel }}</p>
          </div>
        </div>
      </div>

      <div v-if="!editing" class="shrink-0 flex flex-col items-end gap-1.5">
        <button
          v-if="!isPermanent && canPromote"
          type="button"
          :disabled="promoting"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-3 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
          @click="promote"
        >{{ promoting ? 'Updating…' : 'Update' }}</button>
        <button
          v-else-if="isPermanent && canEdit"
          type="button"
          class="rounded border border-accent/40 text-accent font-medium text-sm px-3 py-1.5 hover:bg-accent/10 transition-colors"
          @click="startEdit"
        >Edit</button>

        <!-- Actions dropdown: submit record / submit opinion / suggest move -->
        <div
          v-if="canSubmitRecord || (canEdit && isPermanent)"
          ref="actionsMenuRef"
          class="relative"
        >
          <button
            type="button"
            class="flex items-center gap-1.5 rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 text-xs px-3 py-1.5 transition-colors"
            :class="{ 'border-zinc-500 text-zinc-100': actionsOpen }"
            @click="actionsOpen = !actionsOpen"
          >
            Actions
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 transition-transform" :class="{ 'rotate-180': actionsOpen }" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div
            v-if="actionsOpen"
            role="menu"
            class="absolute right-0 top-full mt-1 min-w-[11rem] rounded-xl border border-zinc-800 bg-zinc-950 shadow-lg shadow-black/40 py-1 z-20"
          >
            <NuxtLink
              v-if="canSubmitRecord"
              :to="`/records/submit?position=${level.position}`"
              role="menuitem"
              class="block px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
              @click="actionsOpen = false"
            >Submit record</NuxtLink>
            <NuxtLink
              v-if="canSubmitRecord"
              :to="`/opinions/submit?position=${level.position}`"
              role="menuitem"
              class="block px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
              @click="actionsOpen = false"
            >Submit opinion</NuxtLink>
            <template v-if="canEdit && isPermanent && !moveBelowActive && !pendingMoveSuccess && !groupMoveActive">
              <div v-if="canSubmitRecord" class="my-1 border-t border-zinc-800" />
              <button
                type="button"
                role="menuitem"
                class="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
                @click="actionsOpen = false; startMoveBelow()"
              >Suggest move…</button>
              <button
                v-if="isAdminLevel"
                type="button"
                role="menuitem"
                class="w-full text-left px-3 py-1.5 text-sm text-accent hover:bg-accent/10 transition-colors"
                @click="actionsOpen = false; placementEditorOpen = true"
              >Drag to place…</button>
              <button
                v-if="isAdminLevel"
                type="button"
                role="menuitem"
                class="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
                @click="startGroupMove()"
              >Group move…</button>
            </template>
          </div>
        </div>

        <!-- Pick-mode active state -->
        <template v-if="canEdit && isPermanent && moveBelowActive">
          <button
            type="button"
            class="rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs px-3 py-1 transition-colors"
            @click="stopMoveBelow"
          >Cancel pick</button>
          <span class="text-[11px] text-sky-400">← pick a level in the list</span>
        </template>

        <span v-if="promoteError" class="text-[11px] text-red-400">{{ promoteError }}</span>
      </div>
    </header>

    <!-- Suggest-move submission: admins/mods only, outside edit mode -->
    <section v-if="canEdit && isPermanent && !editing && (pendingMoveReady || pendingMoveSuccess)" class="rounded-md border border-sky-900/50 bg-sky-950/20 p-4 mb-6 space-y-3">
      <p v-if="pendingMoveSuccess" class="text-xs text-emerald-400">
        Pending move submitted — a moderator will review it.
      </p>
      <template v-else>
        <p class="text-[11px] text-sky-400 uppercase tracking-widest font-medium">Submit as pending move</p>
        <p class="text-[11px] text-zinc-500">
          Propose moving <span class="text-zinc-300">{{ level.name }}</span> from #{{ level.position }} to #{{ draftPosition }} for mod review.
        </p>
        <textarea
          v-model="pendingMoveNotes"
          rows="2"
          maxlength="2000"
          placeholder="Optional notes (why this level should move…)"
          class="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p v-if="pendingMoveError" class="text-xs text-red-400">{{ pendingMoveError }}</p>
        <button
          type="button"
          :disabled="pendingMoveSubmitting"
          class="rounded bg-sky-700 hover:bg-sky-600 text-zinc-100 font-medium text-xs px-3 py-1.5 transition-colors disabled:opacity-60"
          @click="submitPendingMove"
        >{{ pendingMoveSubmitting ? 'Submitting…' : 'Submit pending move' }}</button>
      </template>
    </section>

    <!-- Group move panel: admins only, two-phase -->
    <section v-if="isAdminLevel && isPermanent && groupMoveActive && !editing" class="rounded-md border border-violet-900/50 bg-violet-950/20 p-4 mb-6 space-y-3">

      <!-- Phase 1: select levels -->
      <template v-if="groupMovePhase !== 'target'">
        <p class="text-[11px] text-violet-400 uppercase tracking-widest font-medium">
          Group move — <span class="normal-case font-normal">{{ groupMovePicks?.length ? `${groupMovePicks.length} selected` : 'select levels' }}</span>
        </p>
        <p class="text-[11px] text-zinc-500">← Click levels in the list to add them. Click again to remove.</p>
        <ul v-if="groupMovePicks?.length" class="space-y-0.5">
          <li v-for="lvl in groupMovePicks" :key="lvl.position" class="flex items-center gap-2 text-xs">
            <span class="text-zinc-500 tabular-nums w-10 shrink-0">#{{ lvl.position }}</span>
            <span class="text-zinc-200">{{ lvl.name }}</span>
          </li>
        </ul>
        <div class="flex items-center gap-2">
          <button
            type="button"
            :disabled="!groupMovePicks?.length"
            class="rounded bg-violet-700 hover:bg-violet-600 text-zinc-100 font-medium text-xs px-3 py-1.5 transition-colors disabled:opacity-60"
            @click="continueGroupMove"
          >Continue →</button>
          <button
            type="button"
            class="rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs px-3 py-1.5 transition-colors"
            @click="stopGroupMove"
          >Cancel</button>
        </div>
      </template>

      <!-- Phase 2: pick target, then confirm -->
      <template v-else>
        <p class="text-[11px] text-violet-400 uppercase tracking-widest font-medium">Group move — pick target</p>

        <!-- 2a: waiting for target click -->
        <template v-if="!groupMoveTargetPick">
          <p class="text-[11px] text-zinc-500">← Click a level in the list to place the group below it.</p>
          <ul class="space-y-0.5">
            <li v-for="lvl in groupMovePicks" :key="lvl.position" class="flex items-center gap-2 text-xs">
              <span class="text-zinc-500 tabular-nums w-10 shrink-0">#{{ lvl.position }}</span>
              <span class="text-zinc-200">{{ lvl.name }}</span>
            </li>
          </ul>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs px-3 py-1.5 transition-colors"
              @click="backGroupMove"
            >← Back</button>
            <button
              type="button"
              class="rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs px-3 py-1.5 transition-colors"
              @click="stopGroupMove"
            >Cancel</button>
          </div>
        </template>

        <!-- 2b: target picked, show confirmation -->
        <template v-else>
          <p class="text-[11px] text-zinc-300">
            Move <span class="text-violet-300">{{ groupMovePicks?.length }} level{{ groupMovePicks?.length !== 1 ? 's' : '' }}</span>
            below <span class="text-zinc-100">#{{ groupMoveTargetPick.position }} {{ groupMoveTargetPick.name }}</span>
            <span class="text-zinc-500"> ({{ groupMoveDelta != null && groupMoveDelta > 0 ? '+' : '' }}{{ groupMoveDelta }} positions)</span>
          </p>
          <ul class="space-y-0.5">
            <li v-for="lvl in groupMovePicks" :key="lvl.position" class="flex items-center gap-2 text-xs text-zinc-400">
              <span class="tabular-nums w-10 shrink-0">#{{ lvl.position }}</span>
              <span>{{ lvl.name }}</span>
              <span class="text-zinc-600">→ #{{ lvl.position + (groupMoveDelta ?? 0) }}</span>
            </li>
          </ul>
          <p v-if="groupMoveError" class="text-xs text-red-400">{{ groupMoveError }}</p>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              :disabled="groupMoveSubmitting"
              class="rounded bg-violet-700 hover:bg-violet-600 text-zinc-100 font-medium text-xs px-3 py-1.5 transition-colors disabled:opacity-60"
              @click="submitGroupMove"
            >{{ groupMoveSubmitting ? 'Moving…' : 'Apply group move' }}</button>
            <button
              type="button"
              :disabled="groupMoveSubmitting"
              class="rounded border border-violet-700/60 text-violet-300 hover:bg-violet-900/30 text-xs px-3 py-1.5 transition-colors disabled:opacity-60"
              @click="submitGroupMoveRequest"
            >Send to move requests</button>
            <button
              type="button"
              class="rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs px-3 py-1.5 transition-colors"
              @click="backGroupMove"
            >← Back</button>
            <button
              type="button"
              class="rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs px-3 py-1.5 transition-colors"
              @click="stopGroupMove"
            >Cancel</button>
          </div>
        </template>
      </template>
    </section>

    <!-- Edit form -->
    <section v-if="editing" class="rounded-md border border-accent/40 bg-zinc-950/80 p-5 mb-6 space-y-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-xs uppercase tracking-widest text-accent font-medium">Editing level</h2>
        <span class="text-[11px] text-zinc-500">Currently at #{{ level.position }}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Always-visible: name, position, level ID -->
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name</span>
          <input v-model="draft.name" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Position <span class="text-zinc-600 normal-case">— moves the level, shifts neighbors</span></span>
          <div class="mt-1 flex items-center gap-2">
            <input v-model="draftPosition" type="number" inputmode="numeric" min="1" class="flex-1 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            <button
              v-if="!moveBelowActive"
              type="button"
              class="shrink-0 rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1.5 transition-colors"
              title="Click a level in the left panel to place this one immediately below it"
              @click="startMoveBelow"
            >Move below…</button>
            <button
              v-else
              type="button"
              class="shrink-0 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs px-2.5 py-1.5 transition-colors"
              @click="stopMoveBelow"
            >Cancel pick</button>
          </div>

        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID</span>
          <input v-model="draft.gd_id" inputmode="numeric" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>

        <!-- Gameplay section -->
        <div class="sm:col-span-2 rounded border border-zinc-800/80 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="gameplayOpen"
            @click="gameplayOpen = !gameplayOpen"
          >
            <span>Gameplay</span>
            <svg :class="{ 'rotate-180': gameplayOpen }" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="gameplayOpen" class="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
              <input v-model="draft.gddl_tier" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Difficulty</span>
              <input v-model="draft.difficulty" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
              <input v-model="draft.main_skillset" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">— 0–10</span></span>
              <input v-model="draft.enjoyment" inputmode="decimal" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Year verified</span>
              <input v-model="draft.year_verified" inputmode="numeric" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
        </div>

        <!-- Credits section -->
        <div class="sm:col-span-2 rounded border border-zinc-800/80 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="creditsOpen"
            @click="creditsOpen = !creditsOpen"
          >
            <span>Credits</span>
            <svg :class="{ 'rotate-180': creditsOpen }" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="creditsOpen" class="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="block sm:col-span-2">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Creator(s) <span class="text-zinc-600 normal-case">— comma-separated</span></span>
              <input v-model="draft.creator" placeholder="e.g. Knobbelboy, Riot" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verifier</span>
              <input v-model="draft.verifier" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
        </div>

        <!-- Verification section -->
        <div class="sm:col-span-2 rounded border border-zinc-800/80 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="verificationOpen"
            @click="verificationOpen = !verificationOpen"
          >
            <span>Verification</span>
            <svg :class="{ 'rotate-180': verificationOpen }" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="verificationOpen" class="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="block sm:col-span-2">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification (text)</span>
              <input v-model="draft.verification" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block sm:col-span-2">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification URL</span>
              <input v-model="draft.verification_url" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
          </div>
        </div>

        <!-- Flags section -->
        <div class="sm:col-span-2 rounded border border-zinc-800/80 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="flagsOpen"
            @click="flagsOpen = !flagsOpen"
          >
            <span>Flags</span>
            <svg :class="{ 'rotate-180': flagsOpen }" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="flagsOpen" class="px-3 pb-3 space-y-3">
            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none pt-1">
              <input v-model="draft.same_as_above" type="checkbox" class="mt-0.5 accent-accent" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Duplicate (same difficulty as above)</span>
                <span class="text-zinc-500 normal-case">— inherits the previous level's points (auto-derived from tier).</span>
              </span>
            </label>
            <div v-if="draft.same_as_above" class="pl-6">
              <span class="block text-[11px] uppercase tracking-widest text-zinc-500">Original level <span class="text-zinc-600 normal-case">makes the Duplicate tag link</span></span>
              <div class="mt-1 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                  @click="editDuplicatePickerOpen = true"
                >{{ draftDuplicateOf ? 'Change…' : 'Pick a level…' }}</button>
                <span v-if="draftDuplicateOf" class="text-xs text-zinc-200 truncate">
                  #{{ draftDuplicateOf.position }} {{ draftDuplicateOf.name }}
                </span>
                <button
                  v-if="draftDuplicateOf"
                  type="button"
                  class="text-[11px] text-zinc-500 hover:text-red-400"
                  @click="draftDuplicateOf = null; draft.duplicate_of_id = null"
                >clear</button>
              </div>
            </div>
            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input v-model="draft.is_alternate" type="checkbox" class="mt-0.5 accent-accent" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Alternate</span>
                <span class="text-zinc-500 normal-case">— mark this level as a related variation of an existing entry. Doesn't affect points.</span>
              </span>
            </label>
            <div v-if="draft.is_alternate" class="pl-6">
              <span class="block text-[11px] uppercase tracking-widest text-zinc-500">Original level <span class="text-zinc-600 normal-case">makes the Alternate tag link</span></span>
              <div class="mt-1 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  class="rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
                  @click="editAlternatePickerOpen = true"
                >{{ draftAlternateOf ? 'Change…' : 'Pick a level…' }}</button>
                <span v-if="draftAlternateOf" class="text-xs text-zinc-200 truncate">
                  #{{ draftAlternateOf.position }} {{ draftAlternateOf.name }}
                </span>
                <button
                  v-if="draftAlternateOf"
                  type="button"
                  class="text-[11px] text-zinc-500 hover:text-red-400"
                  @click="draftAlternateOf = null; draft.alternate_of_id = null"
                >clear</button>
              </div>
            </div>
            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input v-model="draft.tentative_placement" type="checkbox" class="mt-0.5 accent-yellow-400" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Tentative placement</span>
                <span class="text-zinc-500 normal-case">— shown as a yellow tag when this level's position is uncertain.</span>
              </span>
            </label>
          </div>
        </div>

        <!-- Sources dropdown -->
        <div class="sm:col-span-2 rounded border border-zinc-800/80 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="sourcesOpen"
            @click="sourcesOpen = !sourcesOpen"
          >
            <span>
              Sources
              <span v-if="selectedSources.length" class="normal-case tracking-normal text-accent ml-1">{{ selectedSources.join(' | ') }}</span>
            </span>
            <svg
              :class="{ 'rotate-180': sourcesOpen }"
              class="w-3.5 h-3.5 transition-transform"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="sourcesOpen" class="px-3 pb-3">
            <div v-if="availableSources.length" class="flex flex-wrap gap-1.5">
              <label
                v-for="src in availableSources"
                :key="src"
                class="cursor-pointer select-none px-2.5 py-1 rounded border text-xs transition-colors"
                :class="selectedSources.includes(src)
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-zinc-700 text-zinc-400 bg-zinc-900 hover:text-zinc-200 hover:border-zinc-600'"
              >
                <input type="checkbox" :checked="selectedSources.includes(src)" class="sr-only" @change="toggleSource(src)" />
                {{ src }}
              </label>
            </div>
            <p v-else class="text-xs text-zinc-600">Loading sources…</p>
          </div>
        </div>

        <!-- Fields that override values pulled from the GD API. Collapsed by
             default since they're only used to correct/replace API data. -->
        <div class="sm:col-span-2 rounded border border-zinc-800/80 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="apiOverridesOpen"
            @click="apiOverridesOpen = !apiOverridesOpen"
          >
            <span>
              API overrides
              <span class="text-zinc-600 normal-case tracking-normal">— replace info pulled from Geometry Dash</span>
            </span>
            <svg
              :class="{ 'rotate-180': apiOverridesOpen }"
              class="w-3.5 h-3.5 transition-transform"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="apiOverridesOpen" class="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Publisher</span>
              <input v-model="draft.publisher" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Rated</span>
              <input v-model="draft.rated" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label v-if="isAdminLevel" class="block sm:col-span-2">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">
                Description override <span class="text-zinc-600 normal-case">— admin only, replaces the GD description</span>
              </span>
              <textarea
                v-model="draft.description_override"
                rows="3"
                placeholder="Leave blank to use the description pulled from GD."
                class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3 pt-2 flex-wrap">
        <button
          type="button"
          :disabled="saving"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
          @click="saveEdit"
        >{{ saving ? 'Saving…' : 'Save' }}</button>
        <button
          type="button"
          class="rounded border border-zinc-700 text-sm px-4 py-1.5 hover:border-zinc-600 transition-colors"
          @click="cancelEdit"
        >Cancel</button>
        <button
          v-if="isAdminLevel"
          type="button"
          :disabled="sendingToAwaiting"
          class="ml-auto rounded border border-amber-900/60 text-amber-300 text-sm px-4 py-1.5 hover:bg-amber-950/40 hover:border-amber-700 disabled:opacity-60 transition-colors"
          title="Move this level back to the Awaiting Placement list"
          @click="sendToAwaiting"
        >{{ sendingToAwaiting ? 'Sending…' : 'Send to awaiting' }}</button>
        <button
          v-if="isAdminLevel"
          type="button"
          :disabled="deleting"
          class="rounded border border-red-900/60 text-red-400 text-sm px-4 py-1.5 hover:bg-red-950/40 hover:border-red-700 disabled:opacity-60 transition-colors"
          @click="deleteLevel"
        >{{ deleting ? 'Deleting…' : 'Delete level' }}</button>
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
        <span v-if="deleteError" class="text-xs text-red-400">{{ deleteError }}</span>
        <span v-if="sendToAwaitingError" class="text-xs text-red-400">{{ sendToAwaitingError }}</span>
      </div>
    </section>

    <template v-else>
      <!-- Verification: real embed if YouTube; link card otherwise -->
      <div v-if="ytId" class="aspect-video rounded-xl border border-zinc-800 bg-black mb-6 overflow-hidden">
        <iframe
          :src="`https://www.youtube.com/embed/${ytId}`"
          class="w-full h-full"
          :title="level.verification ?? 'Verification'"
          frameborder="0"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        />
      </div>
      <a
        v-else-if="level.verification_url || fallbackSearch"
        :href="(level.verification_url ?? fallbackSearch)!"
        target="_blank"
        rel="noopener"
        class="block aspect-video rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 mb-6 relative group overflow-hidden hover:border-accent/40 transition-colors"
      >
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="text-center px-6">
            <div class="w-14 h-14 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center mx-auto mb-3 group-hover:bg-accent/30 transition-colors">
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-accent translate-x-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <p class="text-sm font-medium text-zinc-300 max-w-md mx-auto line-clamp-2">{{ level.verification ?? 'Watch verification' }}</p>
            <p class="text-[11px] text-zinc-500 mt-2 uppercase tracking-wider">
              {{ level.verification_url ? 'Open verification ↗' : 'Search YouTube' }}
            </p>
          </div>
        </div>
      </a>

      <!-- Tags -->
      <div v-if="level.tentative_placement || tags.length || level.gd_id" class="flex flex-wrap items-center gap-2 mb-6">
        <span
          v-if="level.tentative_placement"
          class="relative group/tent px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-yellow-500/60 text-yellow-400 cursor-default"
        >
          Tentative
          <span class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-[11px] leading-relaxed text-zinc-200 shadow-xl opacity-0 transition-opacity group-hover/tent:opacity-100 z-20">
            Levels that do not have concrete estimations, leaving their placement on the List somewhat inaccurate.
          </span>
        </span>
        <template v-for="(t, i) in tags" :key="`${i}-${t.label}`">
          <NuxtLink
            v-if="t.to"
            :to="t.to"
            :title="t.title"
            class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-accent hover:border-accent/40 transition-colors"
          >{{ t.label }}</NuxtLink>
          <span
            v-else
            :title="t.title"
            class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300"
          >{{ t.label }}</span>
        </template>

        <div v-if="level.gd_id" class="relative">
          <button
            ref="infoBtn"
            type="button"
            class="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-accent hover:border-accent/40 transition-colors text-[11px] font-semibold flex items-center justify-center"
            :aria-expanded="infoOpen"
            aria-label="More info from Geometry Dash"
            title="More info from Geometry Dash"
            @click.stop="toggleInfo"
          >i</button>

          <div
            v-if="infoOpen"
            ref="infoPanel"
            class="absolute left-0 top-full mt-2 z-20 w-72 rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40"
          >
            <div class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">GD Info</span>
              <span class="text-[10px] text-zinc-600 tabular-nums">#{{ level.gd_id }}</span>
            </div>

            <div v-if="infoLoading" class="px-3 py-4 text-xs text-zinc-500">Loading…</div>
            <div v-else-if="infoError" class="px-3 py-4 text-xs text-red-400">{{ infoError }}</div>
            <dl
              v-else-if="infoData"
              class="px-3 py-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs"
            >
              <dt class="text-zinc-500">Downloads</dt>
              <dd class="text-zinc-200 tabular-nums">{{ fmtNum(infoData.downloads) }}</dd>

              <dt class="text-zinc-500">Likes</dt>
              <dd class="text-zinc-200 tabular-nums">{{ fmtNum(infoData.likes) }}</dd>

              <dt class="text-zinc-500">Song</dt>
              <dd class="text-zinc-200 truncate" :title="infoData.song.name ?? ''">{{ infoData.song.name ?? '—' }}</dd>

              <dt class="text-zinc-500">Password</dt>
              <dd class="text-zinc-200 font-mono">
                <span v-if="infoData.password === null">Free copy</span>
                <span v-else>{{ infoData.password }}</span>
              </dd>

              <dt class="text-zinc-500">Coins</dt>
              <dd class="text-zinc-200 tabular-nums">
                {{ infoData.coins }}<span v-if="infoData.coins" class="text-zinc-500"> · {{ infoData.verifiedCoins ? 'verified' : 'unverified' }}</span>
              </dd>

              <dt class="text-zinc-500">Length</dt>
              <dd class="text-zinc-200">{{ infoData.length ?? '—' }}</dd>

              <dt class="text-zinc-500">Objects</dt>
              <dd class="text-zinc-200 tabular-nums">
                <span v-if="infoData.objectsApprox">~</span>{{ fmtNum(infoData.objects) }}
              </dd>
            </dl>
          </div>
        </div>
      </div>

      <!-- Description: admin override beats GD's stored description. -->
      <p
        v-if="level.description_override || infoData?.description"
        class="text-sm text-zinc-300 whitespace-pre-wrap mb-6 leading-relaxed"
      >{{ level.description_override || infoData?.description }}</p>

      <!-- Stats grid: identity / scoring -->
      <div
        v-if="visibleTiles1.length"
        class="grid gap-px bg-zinc-800 rounded-md overflow-hidden mb-3"
        :class="gridColsClass(visibleTiles1.length)"
      >
        <div v-if="visibleTiles1.includes('level_id')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
          <div class="flex items-center gap-2">
            <a
              :href="gdLevelUrl!"
              target="_blank"
              rel="noopener"
              class="tabular-nums text-base text-zinc-100 hover:text-accent transition-colors"
            >{{ level.gd_id }}</a>
            <button
              type="button"
              :title="gdIdCopied ? 'Copied!' : 'Copy ID'"
              class="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
              @click="copyGdId"
            >
              <svg v-if="!gdIdCopied" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 text-green-400" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>
        </div>
        <div v-if="visibleTiles1.includes('list_points')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">List Points</div>
          <div class="tabular-nums text-base text-amber-300">{{ formatPoints(level.points) }}</div>
        </div>
        <div v-if="visibleTiles1.includes('enjoyment')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Enjoyment</div>
          <div class="tabular-nums text-base text-zinc-100">{{ Number(level.enjoyment).toFixed(1) }}</div>
        </div>
        <div v-if="visibleTiles1.includes('edel_enjoyment')" class="bg-zinc-950 p-4" title="Aredl community enjoyment">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">EDEL Enjoyment</div>
          <div class="tabular-nums text-base text-zinc-100">{{ Number(level.edel_enjoyment).toFixed(1) }}</div>
        </div>
        <div v-if="visibleTiles1.includes('gddl_tier')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
          <div class="tabular-nums text-base text-zinc-100">{{ gddlTierLabel }}</div>
        </div>
        <div v-if="visibleTiles1.includes('verify_date')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify Date</div>
          <div class="tabular-nums text-sm text-zinc-100">{{ level.verify_date }}</div>
        </div>
      </div>

      <!-- Stats grid: gameplay metadata -->
      <div
        v-if="visibleTiles2.length"
        class="grid gap-px bg-zinc-800 rounded-md overflow-hidden mb-6"
        :class="gridColsClass(visibleTiles2.length)"
      >
        <div v-if="visibleTiles2.includes('difficulty')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Difficulty</div>
          <div class="text-sm text-zinc-100">{{ level.difficulty }}</div>
        </div>
        <div v-if="visibleTiles2.includes('rated')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Rated</div>
          <div class="text-sm text-zinc-100">{{ ratedLabel }}</div>
        </div>
        <div v-if="visibleTiles2.includes('main_skillset')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Main Skillset</div>
          <div class="text-sm text-zinc-100">{{ level.main_skillset }}</div>
        </div>
        <div v-if="visibleTiles2.includes('pov_placement')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Placement on Verification</div>
          <div class="tabular-nums text-sm text-zinc-100">{{ level.pov_placement }}</div>
        </div>
        <div v-if="visibleTiles2.includes('community_tier')" class="bg-zinc-950 p-4 relative">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex items-center gap-1.5">
            <span>Community Tier</span>
            <button
              v-if="hasDistribution"
              ref="distBtn"
              type="button"
              class="w-4 h-4 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-accent hover:border-accent/40 transition-colors text-[10px] font-semibold flex items-center justify-center leading-none"
              :aria-expanded="distOpen"
              aria-label="Show rating distribution"
              title="Show rating distribution"
              @click.stop="toggleDist"
            >i</button>
          </div>
          <div class="text-sm text-zinc-100">
            {{ community?.community_tier }}
            <span class="text-[10px] text-zinc-500 ml-1">· {{ community?.count }} rating{{ community?.count === 1 ? '' : 's' }}</span>
          </div>

          <div
            v-if="distOpen && hasDistribution"
            ref="distPanel"
            class="absolute right-0 top-full mt-2 z-20 w-72 rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40"
          >
            <div class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Rating distribution</span>
              <span class="text-[10px] text-zinc-600 tabular-nums">{{ community?.count }} total</span>
            </div>
            <ul class="px-3 py-2 space-y-1.5">
              <li v-for="row in distRows" :key="row.label" class="flex items-center gap-2 text-[11px]">
                <span class="w-16 shrink-0 truncate text-zinc-400">{{ row.label }}</span>
                <div class="flex-1 h-2 rounded bg-zinc-900 overflow-hidden">
                  <div class="h-full bg-accent" :style="{ width: row.pct + '%' }" />
                </div>
                <span class="w-6 shrink-0 text-right tabular-nums text-zinc-300">{{ row.count }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Credits -->
      <details v-if="creditRows.length" open class="group rounded-xl border border-zinc-800 bg-zinc-950/60 mb-6">
        <summary class="px-4 py-3 flex items-center justify-between gap-2 cursor-pointer select-none list-none hover:bg-zinc-900/40 transition-colors rounded-md">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Credits</h2>
          <span class="text-zinc-600 text-[11px] group-open:rotate-180 transition-transform inline-block">▾</span>
        </summary>
        <dl class="px-4 pb-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <template v-for="row in creditRows" :key="row.label">
            <dt class="text-zinc-500">{{ row.label }}</dt>
            <dd class="text-zinc-200">{{ row.value }}</dd>
          </template>
        </dl>
      </details>

      <!-- Metadata block -->
      <details v-if="infoRows.length" open class="group rounded-xl border border-zinc-800 bg-zinc-950/60 mb-6">
        <summary class="px-4 py-3 flex items-center justify-between gap-2 cursor-pointer select-none list-none hover:bg-zinc-900/40 transition-colors rounded-md">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Information</h2>
          <span class="text-zinc-600 text-[11px] group-open:rotate-180 transition-transform inline-block">▾</span>
        </summary>
        <dl class="px-4 pb-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <template v-for="row in infoRows" :key="row.label">
            <dt class="text-zinc-500">{{ row.label }}</dt>
            <dd class="text-zinc-200 truncate" :title="row.value">{{ row.value }}</dd>
          </template>
        </dl>
      </details>

      <!-- Position history: most recent first. Recorded on admin moves. -->
      <section class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Position History</h2>

        <PositionHistoryChart
          :all-series="chartAllSeries"
          :aredl-series="chartAredlSeries"
        />

        <div v-if="historyByDay.length" class="space-y-4">
          <div v-for="day in historyByDay" :key="day.date" class="rounded-xl border border-zinc-800 bg-zinc-950/60">
            <div class="px-4 py-2 border-b border-zinc-800 flex items-baseline justify-between gap-3">
              <h3 class="text-sm font-medium text-zinc-100">{{ day.label }}</h3>
              <span class="text-[11px] text-zinc-500 tabular-nums">
                {{ day.entries.length }} change{{ day.entries.length === 1 ? '' : 's' }}
              </span>
            </div>
            <ul class="divide-y divide-zinc-900/60">
              <li
                v-for="entry in day.entries"
                :key="entry.id"
                class="px-4 py-2 text-sm flex items-center gap-2"
              >
                <span
                  v-if="entry.from_position == null"
                  class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-emerald-900/40 text-emerald-300 border border-emerald-800/60"
                  title="Added to the main list"
                >Added</span>
                <span
                  v-else-if="entry.to_position < entry.from_position"
                  class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-900/40 text-sky-300 border border-sky-800/60"
                  title="Moved up"
                >▲ Moved</span>
                <span
                  v-else
                  class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-800/60"
                  title="Moved down"
                >▼ Moved</span>

                <span
                  v-if="entry.source === 'aredl'"
                  class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-950/50 text-sky-300/90 border border-sky-900/60"
                  :title="entry.raw_to_position != null
                    ? `From AREDL history — AREDL ${entry.raw_from_position != null ? '#' + entry.raw_from_position + ' → ' : ''}#${entry.raw_to_position}, converted to ALL placements`
                    : 'Imported from AREDL history, converted to ALL placements'"
                >AREDL</span>

                <span class="shrink-0 text-base font-semibold tabular-nums text-zinc-300 ml-auto">
                  <template v-if="entry.from_position == null">#{{ entry.to_position }}</template>
                  <template v-else>
                    <span class="text-zinc-500">#{{ entry.from_position }}</span>
                    <span class="text-zinc-600 mx-1">→</span>
                    <span class="text-accent">#{{ entry.to_position }}</span>
                  </template>
                </span>

                <button
                  v-if="isAdminLevel"
                  type="button"
                  :disabled="deletingHistoryId != null"
                  class="shrink-0 text-[10px] text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-40"
                  title="Remove from changelog"
                  @click="deleteHistoryEntry(entry.id)"
                >✕</button>
              </li>
            </ul>
          </div>
        </div>
        <div v-else class="text-xs text-zinc-600">
          No placement changes recorded. Current placement: <span class="text-zinc-300 tabular-nums">#{{ shownPlacement }}</span>.
        </div>
      </section>
    </template>

    <!-- Rankings on other lists -->
    <section class="mt-6 rounded-xl border border-zinc-800/70 bg-zinc-950">
      <details :open="otherListsOpen" class="group" @toggle="onOtherListsToggle">
        <summary class="px-4 py-3 flex items-center justify-between gap-2 cursor-pointer select-none list-none hover:bg-zinc-900/40 transition-colors rounded-md">
          <h3 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">Rankings on other lists</h3>
          <span class="text-zinc-600 text-[11px] group-open:rotate-180 transition-transform inline-block">▾</span>
        </summary>

        <!-- Actual rankings -->
        <ul v-if="visibleOtherLists.length > 0" class="divide-y divide-zinc-900 border-t border-zinc-900">
          <li
            v-for="entry in visibleOtherLists"
            :key="entry.list"
            class="flex items-center gap-3 px-4 py-3"
          >
            <span class="text-sm font-medium text-zinc-200">{{ entry.list }}</span>
            <a
              v-if="entry.url"
              :href="entry.url"
              target="_blank"
              rel="noopener"
              class="ml-auto tabular-nums text-base text-amber-300 hover:underline"
            >#{{ entry.position }}</a>
            <span v-else class="ml-auto tabular-nums text-base text-amber-300">#{{ entry.position }}</span>
          </li>
        </ul>

        <!-- GDL estimation — only for extreme levels not already on GDL, shown once data arrives -->
        <div v-if="isExtremeLevel && !level.other_lists?.some(e => e.list === 'GDL') && gdlEstimatedData" class="border-t border-zinc-900 px-4 py-3 space-y-2">
          <template v-if="gdlEstimatedData.bracket.above && !gdlEstimatedData.bracket.below">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-zinc-400">GDL</span>
              <span class="ml-auto text-sm text-zinc-500 italic">Not List Worthy</span>
            </div>
          </template>
          <template v-else-if="gdlEstimatedData.estimated_gdl">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-zinc-300">GDL (estimated)</span>
              <span class="tabular-nums text-base" :class="gdlEstimatedData.estimated_gdl <= 150 ? 'text-amber-300' : 'text-zinc-400'">~#{{ gdlEstimatedData.estimated_gdl }}</span>
            </div>
            <p v-if="gdlEstimatedData.bracket.above || gdlEstimatedData.bracket.below" class="text-[11px] text-zinc-600">
              Based on:
              <template v-if="gdlEstimatedData.bracket.above">
                <NuxtLink :to="`/levels/${gdlEstimatedData.bracket.above.position}`" class="text-zinc-500 hover:text-accent">{{ gdlEstimatedData.bracket.above.name }}</NuxtLink>
                (GDL #{{ gdlEstimatedData.bracket.above.gdl_position }})
              </template>
              <template v-if="gdlEstimatedData.bracket.above && gdlEstimatedData.bracket.below"> — </template>
              <template v-if="gdlEstimatedData.bracket.below">
                <NuxtLink :to="`/levels/${gdlEstimatedData.bracket.below.position}`" class="text-zinc-500 hover:text-accent">{{ gdlEstimatedData.bracket.below.name }}</NuxtLink>
                (GDL #{{ gdlEstimatedData.bracket.below.gdl_position }})
              </template>
            </p>
          </template>
        </div>

        <!-- AREDL estimation — only for extreme levels not already on AREDL, shown once data arrives -->
        <div v-if="isExtremeLevel && !level.other_lists?.some(e => e.list === 'AREDL') && estimatedData" class="border-t border-zinc-900 px-4 py-3 space-y-2">
          <template v-if="estimatedData.bracket.above && !estimatedData.bracket.below">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-zinc-400">AREDL</span>
              <span class="ml-auto text-sm text-zinc-500 italic">Not List Worthy</span>
            </div>
          </template>
          <template v-else-if="estimatedData.estimated_aredl">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-zinc-300">AREDL (estimated)</span>
              <span class="tabular-nums text-base" :class="estimatedData.estimated_aredl <= 150 ? 'text-amber-300' : 'text-zinc-400'">~#{{ estimatedData.estimated_aredl }}</span>
            </div>
            <p v-if="estimatedData.bracket.above || estimatedData.bracket.below" class="text-[11px] text-zinc-600">
              Based on:
              <template v-if="estimatedData.bracket.above">
                <NuxtLink :to="`/levels/${estimatedData.bracket.above.position}`" class="text-zinc-500 hover:text-accent">{{ estimatedData.bracket.above.name }}</NuxtLink>
                (AREDL #{{ estimatedData.bracket.above.aredl_position }})
              </template>
              <template v-if="estimatedData.bracket.above && estimatedData.bracket.below"> — </template>
              <template v-if="estimatedData.bracket.below">
                <NuxtLink :to="`/levels/${estimatedData.bracket.below.position}`" class="text-zinc-500 hover:text-accent">{{ estimatedData.bracket.below.name }}</NuxtLink>
                (AREDL #{{ estimatedData.bracket.below.aredl_position }})
              </template>
            </p>
          </template>
        </div>

        <!-- CL estimation — only for challenge levels not already on CL, shown once data arrives -->
        <div v-if="isChallengeLevel && !level.other_lists?.some(e => e.list === 'Challenge List') && clEstimatedData" class="border-t border-zinc-900 px-4 py-3 space-y-2">
          <template v-if="clEstimatedData.estimated_cl">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-zinc-300">Challenge List (estimated)</span>
              <span class="tabular-nums text-base" :class="clEstimatedData.estimated_cl <= 100 ? 'text-amber-300' : 'text-zinc-400'">~#{{ clEstimatedData.estimated_cl }}</span>
            </div>
            <p v-if="clEstimatedData.bracket.above || clEstimatedData.bracket.below" class="text-[11px] text-zinc-600">
              Based on:
              <template v-if="clEstimatedData.bracket.above">
                <NuxtLink :to="`/levels/${clEstimatedData.bracket.above.position}`" class="text-zinc-500 hover:text-accent">{{ clEstimatedData.bracket.above.name }}</NuxtLink>
                (CL #{{ clEstimatedData.bracket.above.challenge_list_position }})
              </template>
              <template v-if="clEstimatedData.bracket.above && clEstimatedData.bracket.below"> — </template>
              <template v-if="clEstimatedData.bracket.below">
                <NuxtLink :to="`/levels/${clEstimatedData.bracket.below.position}`" class="text-zinc-500 hover:text-accent">{{ clEstimatedData.bracket.below.name }}</NuxtLink>
                (CL #{{ clEstimatedData.bracket.below.challenge_list_position }})
              </template>
            </p>
          </template>
          <template v-else>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-zinc-400">Challenge List</span>
              <span class="ml-auto text-sm text-zinc-500 italic">No estimate available</span>
            </div>
          </template>
        </div>

        <!-- Empty state when nothing applies -->
        <div v-if="visibleOtherLists.length === 0 && !isExtremeLevel && !isChallengeLevel" class="border-t border-zinc-900 px-4 py-3">
          <p class="text-xs text-zinc-600">No external list rankings for this level.</p>
        </div>
      </details>
    </section>

    <!-- Discussion -->
    <section v-if="level.id" class="mt-6">
      <CommentSection kind="level" :target-id="level.id" />
    </section>

    <PlacementEditor
      v-model:open="placementEditorOpen"
      :position="level.position"
      :name="level.name"
      @moved="emit('refresh')"
    />

    <LevelComparisonDrawer
      v-model:open="editDuplicatePickerOpen"
      :confirm-on-pick="true"
      title="Pick the original level"
      hint="Click the level this one is a duplicate of."
      @confirm="(lvl) => { draft.duplicate_of_id = lvl.id ?? null; draftDuplicateOf = { position: lvl.position, name: lvl.name } }"
    />
    <LevelComparisonDrawer
      v-model:open="editAlternatePickerOpen"
      :confirm-on-pick="true"
      title="Pick the original level"
      hint="Click the level this one is an alternate of."
      @confirm="(lvl) => { draft.alternate_of_id = lvl.id ?? null; draftAlternateOf = { position: lvl.position, name: lvl.name } }"
    />
    </div>
  </div>
</template>

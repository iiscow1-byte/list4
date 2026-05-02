<script setup lang="ts">
type Community = {
  count: number
  community_tier: string | null
  community_enjoyment: number | null
  distribution: Record<string, number> | null
}
type Level = {
  position: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
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
  description_override?: string | null
  same_as_above?: number | null
  community?: Community | null
  position_history?: PositionHistoryEntry[]
}
type PositionHistoryEntry = {
  from_position: number | null
  to_position: number
  changed_at: string
  changed_by: string | null
}

const props = defineProps<{ level: Level; readonly?: boolean }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const { data: meRes } = useCurrentUser()
const role = computed(() => meRes.value?.account?.role ?? null)
const isLoggedIn = computed(() => !!meRes.value?.account)
const canPromote = computed(() => role.value === 'admin' && !props.readonly)
const canEdit = computed(() => (role.value === 'admin' || role.value === 'moderator') && !props.readonly)
const canSubmitRecord = computed(() => isLoggedIn.value && !props.readonly)
const isPermanent = computed(() => !!props.level.permanent)

const tags = computed(() => {
  const list: string[] = []
  if (props.level.gddl_tier) list.push(props.level.gddl_tier)
  if (props.level.difficulty) list.push(props.level.difficulty)
  if (props.level.main_skillset) list.push(props.level.main_skillset)
  if (props.level.rated) list.push(props.level.rated)
  if (props.level.placement_source) list.push(props.level.placement_source)
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
const fallbackSearch = computed(() => {
  if (!props.level.verification) return null
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(props.level.verification)}`
})

const gdLevelUrl = computed(() => {
  if (!props.level.gd_id) return null
  return `https://gdbrowser.com/${props.level.gd_id}`
})

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
  if (!confirm('Promote this level to permanent? Future sheet imports will skip its gd_id.')) return
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
  'difficulty' | 'gddl_tier' | 'rated' | 'main_skillset' |
  'verification' | 'verification_url' | 'pov_placement' | 'year_verified' |
  'description_override'
> & { same_as_above: boolean }
const editing = ref(false)
const apiOverridesOpen = ref(false)
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
  main_skillset: '',
  verification: '',
  verification_url: '',
  pov_placement: '',
  year_verified: '',
  description_override: '',
  same_as_above: false,
})
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
  draft.main_skillset = props.level.main_skillset ?? ''
  draft.verification = props.level.verification ?? ''
  draft.verification_url = props.level.verification_url ?? ''
  draft.pov_placement = props.level.pov_placement ?? ''
  draft.year_verified = props.level.year_verified ?? ''
  draft.description_override = props.level.description_override ?? ''
  draft.same_as_above = !!props.level.same_as_above
  draftPosition.value = props.level.position
  saveError.value = null
  deleteError.value = null
  apiOverridesOpen.value = false
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  saveError.value = null
  deleteError.value = null
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
  if (!infoData.value) return null
  const { score, length } = infoData.value
  if (score === 0 && (length === 'Tiny' || length === 'Short') && isChallengeTier.value) {
    return 'Challenge'
  }
  return SCORE_LABELS[score]
})
const infoOpen = ref(false)
const infoData = ref<GdInfo | null>(null)
const infoLoading = ref(false)
const infoError = ref<string | null>(null)
const infoBtn = ref<HTMLElement | null>(null)
const infoPanel = ref<HTMLElement | null>(null)
const lastFetchedId = ref<number | null>(null)

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
  if (!infoOpen.value) return
  const t = e.target as Node
  if (infoPanel.value?.contains(t) || infoBtn.value?.contains(t)) return
  infoOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') infoOpen.value = false
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
  return rows
})

// Stat tiles: rendered only when populated. Two grids preserved from the
// original layout — the first is identity/scoring, the second is gameplay
// metadata. The grid-cols class is picked based on visible-tile count so
// hidden tiles don't leave gray gap-px slots showing through.
type Tile1 = 'level_id' | 'list_points' | 'enjoyment' | 'gddl_tier' | 'verify_date'
type Tile2 = 'difficulty' | 'rated' | 'main_skillset' | 'pov_placement' | 'community_tier'

const community = computed<Community | null>(() => props.level.community ?? null)
const hasCommunityTier = computed(() => !!community.value?.community_tier)
const hasDistribution = computed(() => !!community.value?.distribution)

const visibleTiles1 = computed<Tile1[]>(() => {
  const out: Tile1[] = []
  if (props.level.gd_id)             out.push('level_id')
  if (props.level.points != null)    out.push('list_points')
  if (props.level.enjoyment != null) out.push('enjoyment')
  if (props.level.gddl_tier)         out.push('gddl_tier')
  if (props.level.verify_date)       out.push('verify_date')
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
    await $fetch(`/api/admin/levels/${props.level.position}`, { method: 'PATCH', body: { ...draft } })
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
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Save failed.'
  } finally {
    saving.value = false
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
</script>

<template>
  <div class="px-8 py-6 max-w-3xl mx-auto w-full">
    <header class="mb-6 flex items-start gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-3 flex-wrap">
          <span class="tabular-nums text-accent text-sm">#{{ level.position }}</span>
          <h1 class="text-3xl font-semibold tracking-tight">{{ level.name }}</h1>
        </div>
        <p v-if="level.placement_source || level.year_verified" class="text-xs text-zinc-500 mt-1.5">
          <span v-if="level.placement_source">Source: {{ level.placement_source }}</span>
        </p>
      </div>

      <div v-if="!editing" class="shrink-0 flex flex-col items-end gap-1">
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
        <NuxtLink
          v-if="canSubmitRecord"
          :to="`/records/submit?position=${level.position}`"
          class="rounded border border-zinc-700 text-zinc-300 hover:text-accent hover:border-accent/40 text-xs px-3 py-1 transition-colors"
        >Submit record</NuxtLink>
        <NuxtLink
          v-if="canSubmitRecord"
          :to="`/opinions/submit?position=${level.position}`"
          class="rounded border border-zinc-700 text-zinc-300 hover:text-accent hover:border-accent/40 text-xs px-3 py-1 transition-colors"
        >Submit opinion</NuxtLink>
        <span v-if="promoteError" class="text-[11px] text-red-400">{{ promoteError }}</span>
      </div>
    </header>

    <!-- Edit form -->
    <section v-if="editing" class="rounded-md border border-accent/40 bg-zinc-950/80 p-5 mb-6 space-y-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-xs uppercase tracking-widest text-accent font-medium">Editing level</h2>
        <span class="text-[11px] text-zinc-500">Currently at #{{ level.position }}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name</span>
          <input v-model="draft.name" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Position <span class="text-zinc-600 normal-case">— moves the level, shifts neighbors</span></span>
          <input v-model="draftPosition" type="number" inputmode="numeric" min="1" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID</span>
          <input v-model="draft.gd_id" inputmode="numeric" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none mt-2 sm:mt-6">
          <input v-model="draft.same_as_above" type="checkbox" class="mt-0.5 accent-accent" />
          <span>
            <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Same difficulty as above</span>
            <span class="text-zinc-500 normal-case">— inherits the previous level's points (auto-derived from tier).</span>
          </span>
        </label>

        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Creator(s) <span class="text-zinc-600 normal-case">— comma-separated</span></span>
          <input v-model="draft.creator" placeholder="e.g. Knobbelboy, Riot" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verifier</span>
          <input v-model="draft.verifier" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">— 0–10</span></span>
          <input v-model="draft.enjoyment" inputmode="decimal" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
          <input v-model="draft.gddl_tier" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Difficulty</span>
          <input v-model="draft.difficulty" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
          <input v-model="draft.main_skillset" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Placement on verification</span>
          <input v-model="draft.pov_placement" type="number" inputmode="numeric" min="1" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Year verified</span>
          <input v-model="draft.year_verified" inputmode="numeric" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>

        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification (text)</span>
          <input v-model="draft.verification" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification URL</span>
          <input v-model="draft.verification_url" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>

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
              <input v-model="draft.publisher" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Rated</span>
              <input v-model="draft.rated" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label v-if="role === 'admin'" class="block sm:col-span-2">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">
                Description override <span class="text-zinc-600 normal-case">— admin only, replaces the GD description</span>
              </span>
              <textarea
                v-model="draft.description_override"
                rows="3"
                placeholder="Leave blank to use the description pulled from GD."
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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
          v-if="role === 'admin'"
          type="button"
          :disabled="deleting"
          class="ml-auto rounded border border-red-900/60 text-red-400 text-sm px-4 py-1.5 hover:bg-red-950/40 hover:border-red-700 disabled:opacity-60 transition-colors"
          @click="deleteLevel"
        >{{ deleting ? 'Deleting…' : 'Delete level' }}</button>
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
        <span v-if="deleteError" class="text-xs text-red-400">{{ deleteError }}</span>
      </div>
    </section>

    <template v-else>
      <!-- Verification: real embed if YouTube; link card otherwise -->
      <div v-if="ytId" class="aspect-video rounded-md border border-zinc-800 bg-black mb-6 overflow-hidden">
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
        class="block aspect-video rounded-md border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 mb-6 relative group overflow-hidden hover:border-accent/40 transition-colors"
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
      <div v-if="tags.length || level.gd_id" class="flex flex-wrap items-center gap-2 mb-6">
        <span
          v-for="t in tags"
          :key="t"
          class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300"
        >
          {{ t }}
        </span>

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
            class="absolute left-0 top-full mt-2 z-20 w-72 rounded-md border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40"
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
          <a
            :href="gdLevelUrl!"
            target="_blank"
            rel="noopener"
            class="tabular-nums text-base text-zinc-100 hover:text-accent transition-colors"
          >{{ level.gd_id }}</a>
        </div>
        <div v-if="visibleTiles1.includes('list_points')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">List Points</div>
          <div class="tabular-nums text-base text-amber-300">{{ formatPoints(level.points) }}</div>
        </div>
        <div v-if="visibleTiles1.includes('enjoyment')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Enjoyment</div>
          <div class="tabular-nums text-base text-zinc-100">{{ Number(level.enjoyment).toFixed(1) }}</div>
        </div>
        <div v-if="visibleTiles1.includes('gddl_tier')" class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
          <div class="tabular-nums text-base text-zinc-100">{{ level.gddl_tier }}</div>
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
            class="absolute right-0 top-full mt-2 z-20 w-72 rounded-md border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40"
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
      <section v-if="creditRows.length" class="rounded-md border border-zinc-800 bg-zinc-950/60 mb-6">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Credits</h2>
        <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <template v-for="row in creditRows" :key="row.label">
            <dt class="text-zinc-500">{{ row.label }}</dt>
            <dd class="text-zinc-200">{{ row.value }}</dd>
          </template>
        </dl>
      </section>

      <!-- Metadata block -->
      <section v-if="infoRows.length" class="rounded-md border border-zinc-800 bg-zinc-950/60 mb-6">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Information</h2>
        <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <template v-for="row in infoRows" :key="row.label">
            <dt class="text-zinc-500">{{ row.label }}</dt>
            <dd class="text-zinc-200 truncate" :title="row.value">{{ row.value }}</dd>
          </template>
        </dl>
      </section>

      <!-- Position history: most recent first. Recorded on admin moves. -->
      <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
        <h2 class="text-[10px] uppercase tracking-[0.2em] tabular-nums text-zinc-500 px-4 pt-3 pb-2 flex items-center gap-2">
          Position History
        </h2>
        <ul
          v-if="level.position_history && level.position_history.length"
          class="px-4 pb-3 text-xs divide-y divide-zinc-900/60"
        >
          <li
            v-for="entry in level.position_history"
            :key="entry.changed_at + ':' + entry.to_position"
            class="py-2 flex items-center gap-3 tabular-nums"
          >
            <span class="text-zinc-300">
              <template v-if="entry.from_position != null">
                #{{ entry.from_position }} <span class="text-zinc-600">→</span> #{{ entry.to_position }}
              </template>
              <template v-else>
                Placed at #{{ entry.to_position }}
              </template>
            </span>
            <span v-if="entry.changed_by" class="text-zinc-500">by {{ entry.changed_by }}</span>
            <span class="text-zinc-600 ml-auto">{{ entry.changed_at }}</span>
          </li>
        </ul>
        <div v-else class="px-4 pb-4 text-xs text-zinc-600">
          No placement changes recorded. Current placement: <span class="text-zinc-300 tabular-nums">#{{ level.position }}</span>.
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
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
  'points' | 'difficulty' | 'gddl_tier' | 'rated' | 'main_skillset' |
  'verification' | 'verification_url' | 'year_verified'
>
const editing = ref(false)
const draft = reactive<Record<keyof EditableFields, any>>({
  name: '',
  gd_id: '',
  creator: '',
  verifier: '',
  publisher: '',
  enjoyment: '',
  points: '',
  difficulty: '',
  gddl_tier: '',
  rated: '',
  main_skillset: '',
  verification: '',
  verification_url: '',
  year_verified: '',
})
const saving = ref(false)
const saveError = ref<string | null>(null)

function startEdit() {
  draft.name = props.level.name ?? ''
  draft.gd_id = props.level.gd_id ?? ''
  draft.creator = props.level.creator ?? ''
  draft.verifier = props.level.verifier ?? ''
  draft.publisher = props.level.publisher ?? ''
  draft.enjoyment = props.level.enjoyment ?? ''
  draft.points = props.level.points ?? ''
  draft.difficulty = props.level.difficulty ?? ''
  draft.gddl_tier = props.level.gddl_tier ?? ''
  draft.rated = props.level.rated ?? ''
  draft.main_skillset = props.level.main_skillset ?? ''
  draft.verification = props.level.verification ?? ''
  draft.verification_url = props.level.verification_url ?? ''
  draft.year_verified = props.level.year_verified ?? ''
  saveError.value = null
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  saveError.value = null
}

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
const ratedLabel = computed(() => {
  if (!infoData.value) return null
  const { score, length } = infoData.value
  if (score === 0 && (length === 'Tiny' || length === 'Short')) return 'Challenge'
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
  if (!props.level.gd_id) return
  if (lastFetchedId.value === props.level.gd_id && infoData.value) return
  infoLoading.value = true
  infoError.value = null
  try {
    infoData.value = await $fetch<GdInfo>(`/api/gd/level/${props.level.gd_id}`)
    lastFetchedId.value = props.level.gd_id
  } catch (e: any) {
    infoError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to load.'
  } finally {
    infoLoading.value = false
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

async function saveEdit() {
  if (saving.value) return
  saving.value = true
  saveError.value = null
  try {
    await $fetch(`/api/admin/levels/${props.level.position}`, { method: 'PATCH', body: { ...draft } })
    emit('refresh')
    editing.value = false
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Save failed.'
  } finally {
    saving.value = false
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
          <span
            v-if="isPermanent"
            class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-800/60"
            title="Curated by mods — sheet re-imports will not overwrite this level."
          >Permanent</span>
        </div>
        <p v-if="level.placement_source || level.year_verified" class="text-xs text-zinc-500 mt-1.5">
          <span v-if="level.placement_source">Source: {{ level.placement_source }}</span>
          <span v-if="level.placement_source && level.year_verified" class="mx-2">·</span>
          <span v-if="level.year_verified">verified {{ level.year_verified }}</span>
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
        <span v-if="promoteError" class="text-[11px] text-red-400">{{ promoteError }}</span>
      </div>
    </header>

    <!-- Edit form -->
    <section v-if="editing" class="rounded-md border border-accent/40 bg-zinc-950/80 p-5 mb-6 space-y-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-xs uppercase tracking-widest text-accent font-medium">Editing level</h2>
        <span class="text-[11px] text-zinc-500">Position #{{ level.position }} (not editable)</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name</span>
          <input v-model="draft.name" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID</span>
          <input v-model="draft.gd_id" inputmode="numeric" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Points</span>
          <input v-model="draft.points" inputmode="decimal" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
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
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Publisher</span>
          <input v-model="draft.publisher" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
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
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Rated</span>
          <input v-model="draft.rated" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
          <input v-model="draft.main_skillset" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
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
      </div>

      <div class="flex items-center gap-3 pt-2">
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
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
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

      <!-- Description (from GD) -->
      <p
        v-if="infoData?.description"
        class="text-sm text-zinc-300 whitespace-pre-wrap mb-6 leading-relaxed"
      >{{ infoData.description }}</p>

      <!-- Stats grid -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden mb-3">
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
          <a
            v-if="gdLevelUrl"
            :href="gdLevelUrl"
            target="_blank"
            rel="noopener"
            class="tabular-nums text-base text-zinc-100 hover:text-accent transition-colors"
          >{{ level.gd_id }}</a>
          <div v-else class="tabular-nums text-base text-zinc-600">—</div>
        </div>
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">List Points</div>
          <div class="tabular-nums text-base text-amber-300">{{ formatPoints(level.points) }}</div>
        </div>
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
          <div class="tabular-nums text-base text-zinc-100">{{ level.gddl_tier ?? '—' }}</div>
        </div>
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify Date</div>
          <div class="tabular-nums text-sm text-zinc-100">{{ level.verify_date ?? '—' }}</div>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden mb-6">
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Difficulty</div>
          <div class="text-sm text-zinc-100">{{ level.difficulty ?? '—' }}</div>
        </div>
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Rated</div>
          <div class="text-sm text-zinc-100">{{ ratedLabel ?? (level.gd_id ? '…' : '—') }}</div>
        </div>
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Main Skillset</div>
          <div class="text-sm text-zinc-100">{{ level.main_skillset ?? '—' }}</div>
        </div>
        <div class="bg-zinc-950 p-4">
          <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">POV Placement</div>
          <div class="tabular-nums text-sm text-zinc-100">{{ level.pov_placement ?? '—' }}</div>
        </div>
      </div>

      <!-- Permanent-only credits -->
      <section v-if="isPermanent" class="rounded-md border border-zinc-800 bg-zinc-950/60 mb-6">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Credits</h2>
        <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt class="text-zinc-500">Creator(s)</dt><dd class="text-zinc-200">{{ level.creator ?? '—' }}</dd>
          <dt class="text-zinc-500">Verifier</dt><dd class="text-zinc-200">{{ level.verifier ?? '—' }}</dd>
          <dt class="text-zinc-500">Publisher</dt><dd class="text-zinc-200">{{ level.publisher ?? '—' }}</dd>
          <dt class="text-zinc-500">Enjoyment</dt>
          <dd class="text-zinc-200 tabular-nums">{{ level.enjoyment != null ? Number(level.enjoyment).toFixed(1) : '—' }}</dd>
        </dl>
      </section>

      <!-- Metadata block -->
      <section class="rounded-md border border-zinc-800 bg-zinc-950/60 mb-6">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Information</h2>
        <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt class="text-zinc-500">Source list</dt><dd class="text-zinc-200">{{ level.placement_source ?? '—' }}</dd>
          <dt class="text-zinc-500">Imported from</dt><dd class="text-zinc-400 text-xs">{{ level.source_tab ?? '—' }}</dd>
          <dt class="text-zinc-500">Verification</dt>
          <dd class="text-zinc-200 truncate" :title="level.verification ?? ''">{{ level.verification ?? '—' }}</dd>
          <dt class="text-zinc-500">Year verified</dt><dd class="text-zinc-200">{{ level.year_verified ?? '—' }}</dd>
        </dl>
      </section>

      <!-- Position history (sheet doesn't expose this — placeholder) -->
      <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
        <h2 class="text-[10px] uppercase tracking-[0.2em] tabular-nums text-zinc-500 px-4 pt-3 pb-2 flex items-center gap-2">
          Position History
          <span class="text-[10px] text-zinc-600 normal-case tracking-normal">— not tracked in this dataset</span>
        </h2>
        <div class="px-4 pb-4 text-xs text-zinc-600">
          No placement history available. Current placement: <span class="text-zinc-300 tabular-nums">#{{ level.position }}</span>.
        </div>
      </section>
    </template>
  </div>
</template>

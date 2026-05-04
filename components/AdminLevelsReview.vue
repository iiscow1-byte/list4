<script setup lang="ts">
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
  difficulty: string | null
  enjoyment: number | null
  main_skillset: string | null
  tags: string | null
  notes: string | null
  submitted_at: string
  submitter: string | null
  placement_estimate: number | null
  comparison_level_id: number | null
  comparison_level_name: string | null
  from_open_verification_id: number | null
  same_as_above: number
  duplicate_of_id: number | null
  is_alternate: number
  alternate_of_id: number | null
}

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
const sameAsAbove = ref(false)

// --- Pending-list filters ---
const TIER_MAX_ORD = 44
const PENDING_TAGS = ['old', 'uldm', 'buffed', 'nerfed'] as const
type DifficultyFilter = 'all' | 'extreme' | 'non-extreme'
const filtersOpen = ref(false)
const search = ref('')
const difficultyFilter = ref<DifficultyFilter>('all')
const tierMin = ref(0)
const tierMax = ref(TIER_MAX_ORD)
const pendingTagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })

function tierOrd(label: string | null): number | null {
  if (!label) return null
  const sub = label.match(/^Subtier (\d{1,2})$/)
  if (sub) return Number(sub[1])
  const t = label.match(/^Tier (\d{1,2})$/)
  if (t) return 5 + Number(t[1])
  return null
}
function ordToTier(ord: number): string {
  if (ord <= 5) return `Subtier ${ord}`
  return `Tier ${ord - 5}`
}

const filteredItems = computed<PendingLevel[]>(() => {
  const q = search.value.trim().toLowerCase()
  const activeTags = PENDING_TAGS.filter((t) => pendingTagSet[t])
  const tierBounded = tierMin.value > 0 || tierMax.value < TIER_MAX_ORD
  return items.value.filter((r) => {
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
    return true
  })
})

const activeFilterCount = computed(() => {
  let n = 0
  if (search.value.trim()) n++
  if (difficultyFilter.value !== 'all') n++
  if (tierMin.value > 0 || tierMax.value < TIER_MAX_ORD) n++
  if (PENDING_TAGS.some((t) => pendingTagSet[t])) n++
  return n
})

function resetFilters() {
  search.value = ''
  difficultyFilter.value = 'all'
  tierMin.value = 0
  tierMax.value = TIER_MAX_ORD
  for (const t of PENDING_TAGS) pendingTagSet[t] = false
}

// Tier range guards
watch(tierMin, () => { if (tierMin.value > tierMax.value) tierMin.value = tierMax.value })
watch(tierMax, () => { if (tierMax.value < tierMin.value) tierMax.value = tierMin.value })

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
  const res = await $fetch<{ items: PendingLevel[] }>('/api/admin/levels/pending')
  items.value = res.items
  if (selectedId.value && !items.value.some((r) => r.id === selectedId.value)) {
    selectedId.value = items.value[0]?.id ?? null
  } else if (!selectedId.value && items.value[0]) {
    selectedId.value = items.value[0].id
  }
}
onMounted(load)

watch(selected, async (s) => {
  preview.value = null
  sameAsAbove.value = !!s?.same_as_above
  if (s?.placement_estimate != null) {
    placement.value = String(s.placement_estimate)
    return
  }
  placement.value = ''
  // No submitter estimate — fall back to the midpoint of the tier so the
  // reviewer starts with a sensible default rather than an empty input.
  if (s?.gddl_tier) {
    const tier = s.gddl_tier
    try {
      const res = await $fetch<{ midpoint: number | null }>('/api/admin/levels/tier-midpoint', {
        query: { tier },
      })
      // Guard against the user picking a different submission while the
      // request was in flight.
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
})

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
    const body: any = { action, same_as_above: sameAsAbove.value }
    if (action === 'approve') body.placement = Number(placement.value)
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
    selectedId.value = null
    placement.value = ''
    rejectReason.value = ''
    preview.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    decideLoading.value = false
  }
}

function gdBrowserLink(id: number | null) { return id ? `https://gdbrowser.com/${id}` : null }

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
}
</script>

<template>
  <div class="grid grid-cols-[20%_55%_25%] grid-rows-[minmax(0,1fr)] h-full">
    <!-- Left: pending list -->
    <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
      <div class="p-3 border-b border-zinc-800 shrink-0">
        <div class="flex items-baseline justify-between mb-2">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Pending levels</p>
          <p class="text-[11px] text-zinc-600">
            {{ filteredItems.length }}<span v-if="filteredItems.length !== items.length"> / {{ items.length }}</span> waiting
          </p>
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
            aria-label="Advanced filter"
            title="Advanced filter"
            @click="filtersOpen = !filtersOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
              <path d="M3 4h18l-7 9v6l-4 2v-8z" />
            </svg>
            <span v-if="activeFilterCount" class="tabular-nums">{{ activeFilterCount }}</span>
          </button>
        </div>

        <div v-if="filtersOpen" class="mt-3 space-y-3 text-xs">
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

          <div class="flex items-center justify-between pt-1">
            <button
              type="button"
              class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
              @click="resetFilters"
            >Reset filters</button>
          </div>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <ul v-if="filteredItems.length" class="divide-y divide-zinc-900/60">
          <li v-for="r in filteredItems" :key="r.id">
            <button
              type="button"
              class="w-full text-left px-3 py-2 text-sm transition-colors"
              :class="selectedId === r.id ? 'bg-accent/15 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/70'"
              @click="selectedId = r.id"
            >
              <div class="font-medium truncate flex items-center gap-1.5">
                <span class="truncate">{{ r.name ?? `Level ${r.gd_id}` }}</span>
                <span
                  v-if="r.from_open_verification_id"
                  class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-violet-900/40 text-violet-300 border border-violet-800/60"
                  title="Verification submitted for an open-verification level"
                >Verif</span>
              </div>
              <div class="text-[11px] text-zinc-500 truncate">
                #{{ r.gd_id ?? '?' }} · by {{ r.submitter ?? 'unknown' }}
              </div>
              <div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-600 truncate">
                <span
                  v-if="r.gddl_tier"
                  class="shrink-0 px-1.5 py-px rounded border border-zinc-800 bg-zinc-900 text-zinc-300 tabular-nums"
                >{{ r.gddl_tier }}</span>
                <span
                  v-if="r.difficulty === 'Extreme Demon'"
                  class="shrink-0 px-1.5 py-px rounded border border-red-900/60 bg-red-950/30 text-red-300"
                  title="Extreme Demon"
                >Extreme</span>
                <span class="truncate">{{ r.submitted_at }}</span>
              </div>
            </button>
          </li>
        </ul>
        <div v-else-if="items.length" class="px-3 py-6 text-xs text-zinc-500 text-center">No matches in {{ items.length }} pending.</div>
        <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">No pending submissions.</div>
      </div>
    </aside>

    <!-- Center: submitted level details -->
    <section class="overflow-y-auto min-h-0 px-6 py-6">
      <div v-if="!selected" class="text-center text-sm text-zinc-500 py-12">
        {{ items.length === 0 ? 'No submissions to review.' : 'Pick a submission on the left.' }}
      </div>
      <div v-else class="max-w-2xl mx-auto space-y-5">
        <header>
          <h2 class="text-2xl font-semibold tracking-tight">{{ selected.name ?? `Level ${selected.gd_id}` }}</h2>
          <p class="text-xs text-zinc-500 mt-1">
            Submitted by
            <NuxtLink v-if="selected.submitter" :to="`/users/${selected.submitter}`" class="hover:text-accent">{{ selected.submitter }}</NuxtLink>
            <span v-else>unknown</span>
            · {{ selected.submitted_at }}
          </p>
        </header>

        <div class="flex flex-wrap gap-2">
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
        </div>

        <!-- Stats grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
            <a v-if="gdBrowserLink(selected.gd_id)" :href="gdBrowserLink(selected.gd_id)!" target="_blank" rel="noopener" class="tabular-nums text-sm text-zinc-100 hover:text-accent">{{ selected.gd_id }}</a>
            <div v-else class="text-zinc-600">—</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">FPS</div>
            <div class="text-sm text-zinc-100">{{ selected.fps ?? 'any' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Version</div>
            <div class="text-sm text-zinc-100">{{ selected.game_version ?? 'any' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify date</div>
            <div class="text-sm text-zinc-100">{{ selected.verify_date ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
            <div class="text-sm text-zinc-100">{{ selected.gddl_tier ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Difficulty</div>
            <div class="text-sm text-zinc-100">{{ selected.difficulty ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Skillset</div>
            <div class="text-sm text-zinc-100">{{ selected.main_skillset ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Enjoyment</div>
            <div class="text-sm text-zinc-100 tabular-nums">{{ selected.enjoyment != null ? Number(selected.enjoyment).toFixed(1) : '—' }}</div>
          </div>
        </div>

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
    <aside class="flex flex-col min-h-0 border-l border-zinc-800 bg-zinc-950">
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
          <p
            v-if="selected?.placement_estimate != null"
            class="text-[10px] text-accent mt-1"
          >
            Submitter estimated #{{ selected.placement_estimate }}<span v-if="selected.comparison_level_name"> (compared to {{ selected.comparison_level_name }})</span>.
          </p>
          <p class="text-[10px] text-zinc-500 mt-1">
            <template v-if="goesToVoid">Position in the void list (no difficulty opinion).</template>
            <template v-else>Position in the main list. Existing levels at and below shift down by one.</template>
          </p>
        </div>

        <label class="flex items-start gap-2 cursor-pointer select-none border-t border-zinc-900 pt-3">
          <input v-model="sameAsAbove" type="checkbox" class="mt-0.5 accent-accent" />
          <span>
            <span class="block text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Duplicate (same difficulty as above)</span>
            <span class="block text-[11px] text-zinc-500 mt-0.5">
              Inherits the previous level's points. The level shows as a "Duplicate" on the public list.
              <span v-if="selected.same_as_above" class="text-accent">Submitter requested this.</span>
            </span>
          </span>
        </label>

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

        <div class="mt-auto flex flex-col gap-2 pt-2">
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Reason for denial <span class="text-zinc-600 normal-case">— optional, sent to submitter</span></span>
            <textarea
              v-model="rejectReason"
              rows="2"
              maxlength="4000"
              placeholder="Why this can't be accepted as-is."
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <button
            type="button"
            :disabled="decideLoading || !placement"
            class="w-full rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-medium text-sm py-2 transition-colors disabled:opacity-60"
            @click="decide('approve')"
          >Approve at #{{ placement || '—' }}</button>
          <button
            type="button"
            :disabled="decideLoading"
            class="w-full rounded bg-sky-700 hover:bg-sky-600 text-zinc-50 font-medium text-sm py-2 transition-colors disabled:opacity-60"
            @click="decide('await')"
            title="Approve without a position. Goes to the public awaiting-placement list."
          >Send to awaiting</button>
          <button
            type="button"
            :disabled="decideLoading"
            class="w-full rounded border border-zinc-700 hover:border-red-600 hover:text-red-400 text-sm py-2 transition-colors disabled:opacity-60"
            @click="decide('reject')"
          >Reject</button>
        </div>

        <div
          v-if="banner"
          class="rounded border px-3 py-2 text-xs"
          :class="banner.kind === 'ok' ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300' : 'border-red-900/50 bg-red-950/30 text-red-300'"
        >{{ banner.msg }}</div>
      </div>
      <div v-else class="p-4">
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

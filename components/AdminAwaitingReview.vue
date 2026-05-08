<script setup lang="ts">
type AwaitingLevel = {
  id: number
  gd_id: number | null
  name: string
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
  submitter: string | null
  approved_at: string
  placement_suggestion: number | null
  same_as_above: number
  duplicate_of_id: number | null
  is_alternate: number
  alternate_of_id: number | null
  tentative_placement: number | null
}

type AwaitingRow = Pick<AwaitingLevel, 'id' | 'name' | 'gd_id' | 'gddl_tier' | 'difficulty' | 'main_skillset' | 'approved_at'>

type PreviewRow = { position: number; name: string; rated: string | null; gddl_tier: string | null; difficulty: string | null }
type Preview = {
  placement: number
  above: PreviewRow[]
  below: PreviewRow[]
  featuredAbove: PreviewRow | null
  featuredBelow: PreviewRow | null
}

const items = ref<AwaitingRow[]>([])
const selectedId = ref<number | null>(null)
const search = ref('')

const filteredItems = computed<AwaitingRow[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((r) => {
    const hay = `${r.name ?? ''} ${r.gd_id ?? ''} ${r.gddl_tier ?? ''} ${r.difficulty ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
})

// If the currently-selected row is filtered out of view, fall back to the
// first surviving row so the detail panel doesn't show a stale entry.
watch(filteredItems, (list) => {
  if (selectedId.value && !list.some((r) => r.id === selectedId.value)) {
    selectedId.value = list[0]?.id ?? null
  }
})
const selected = ref<AwaitingLevel | null>(null)
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
const decideLoading = ref(false)
const placement = ref<string>('')
const preview = ref<Preview | null>(null)
const previewLoading = ref(false)
const removeReason = ref<string>('')
const flagsOpen = ref(false)
const isDuplicate = ref(false)
const duplicateOfId = ref<number | null>(null)
const draftDuplicateOf = ref<{ position: number; name: string } | null>(null)
const flagsDuplicatePickerOpen = ref(false)
const isAlternate = ref(false)
const alternateOfId = ref<number | null>(null)
const draftAlternateOf = ref<{ position: number; name: string } | null>(null)
const flagsAlternatePickerOpen = ref(false)
const isTentative = ref(false)
const placementSaved = ref(false)
let placementSaveDebounce: ReturnType<typeof setTimeout> | null = null

async function load(opts: { keepSelection?: boolean } = {}) {
  const res = await $fetch<{ items: AwaitingRow[] }>('/api/awaiting/levels', { query: { page: 1, pageSize: 500 } })
  items.value = res.items
  if (opts.keepSelection) return
  if (selectedId.value && !items.value.some((r) => r.id === selectedId.value)) {
    selectedId.value = items.value[0]?.id ?? null
  } else if (!selectedId.value && items.value[0]) {
    selectedId.value = items.value[0].id
  }
}
onMounted(load)

watch(selectedId, async (id) => {
  placement.value = ''
  preview.value = null
  isDuplicate.value = false
  duplicateOfId.value = null
  draftDuplicateOf.value = null
  isAlternate.value = false
  alternateOfId.value = null
  draftAlternateOf.value = null
  isTentative.value = false
  editingVideo.value = false
  editVideoUrl.value = ''
  if (id == null) { selected.value = null; return }
  try {
    selected.value = await $fetch<AwaitingLevel>(`/api/awaiting/levels/${id}`)
    if (selected.value?.placement_suggestion != null) {
      placement.value = String(selected.value.placement_suggestion)
    }
    isDuplicate.value = !!selected.value?.same_as_above
    duplicateOfId.value = selected.value?.duplicate_of_id ?? null
    isAlternate.value = !!selected.value?.is_alternate
    alternateOfId.value = selected.value?.alternate_of_id ?? null
    isTentative.value = !!selected.value?.tentative_placement
  } catch {
    selected.value = null
  }
}, { immediate: true })

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
  // Auto-save placement_suggestion to DB after a short delay
  if (placementSaveDebounce) clearTimeout(placementSaveDebounce)
  if (selectedId.value) {
    placementSaveDebounce = setTimeout(async () => {
      try {
        await $fetch(`/api/admin/awaiting/${selectedId.value}`, {
          method: 'POST', body: { action: 'save_placement', placement: n },
        })
        placementSaved.value = true
        setTimeout(() => (placementSaved.value = false), 1500)
      } catch { /* non-fatal */ }
    }, 600)
  }
})

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3500)
}

// After an action removes the current row from awaiting, advance the cursor
// to the row that took its place at the same visible index instead of
// jumping back to the top of the list.
function pickNextAfterAction(actedId: number) {
  const oldIdx = filteredItems.value.findIndex((r) => r.id === actedId)
  // load() will repopulate items.value; recompute filteredItems off the new
  // list and pick the entry that now occupies oldIdx (or the new last row).
  return () => {
    const visible = filteredItems.value
    if (visible.length === 0) { selectedId.value = null; return }
    const idx = oldIdx < 0 ? 0 : Math.min(oldIdx, visible.length - 1)
    selectedId.value = visible[idx]?.id ?? null
  }
}

async function decide(action: 'place' | 'remove') {
  if (!selected.value || decideLoading.value) return
  if (action === 'place') {
    const n = Number(placement.value)
    if (!Number.isInteger(n) || n <= 0) {
      flash('err', 'Enter a placement (1-based) before placing.')
      return
    }
  }
  const actedId = selected.value.id
  const advance = pickNextAfterAction(actedId)
  decideLoading.value = true
  try {
    const body: any = { action }
    if (action === 'place') {
      body.placement = Number(placement.value)
      if (tierOverride.value.trim()) body.gddl_tier = tierOverride.value.trim()
      if (difficultyOverride.value.trim()) body.difficulty = difficultyOverride.value.trim()
      body.same_as_above = isDuplicate.value
      body.duplicate_of_id = isDuplicate.value ? (duplicateOfId.value ?? null) : null
      body.is_alternate = isAlternate.value
      body.alternate_of_id = isAlternate.value ? (alternateOfId.value ?? null) : null
      body.tentative_placement = isTentative.value
    }
    if (action === 'remove') body.reason = removeReason.value.trim() || undefined
    await $fetch(`/api/admin/awaiting/${actedId}`, { method: 'POST', body })
    flash('ok', action === 'place' ? `Placed at #${placement.value}.` : 'Removed from awaiting.')
    placement.value = ''
    tierOverride.value = ''
    difficultyOverride.value = ''
    isDuplicate.value = false
    duplicateOfId.value = null
    draftDuplicateOf.value = null
    isAlternate.value = false
    alternateOfId.value = null
    draftAlternateOf.value = null
    isTentative.value = false
    removeReason.value = ''
    preview.value = null
    await load({ keepSelection: true })
    advance()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    decideLoading.value = false
  }
}

async function returnToLevels() {
  if (!selected.value || decideLoading.value) return
  const actedId = selected.value.id
  const advance = pickNextAfterAction(actedId)
  decideLoading.value = true
  try {
    await $fetch(`/api/admin/awaiting/${actedId}`, { method: 'POST', body: { action: 'return' } })
    flash('ok', 'Returned to the levels tab.')
    placement.value = ''
    tierOverride.value = ''
    difficultyOverride.value = ''
    isDuplicate.value = false
    duplicateOfId.value = null
    draftDuplicateOf.value = null
    isAlternate.value = false
    alternateOfId.value = null
    draftAlternateOf.value = null
    isTentative.value = false
    removeReason.value = ''
    preview.value = null
    await load({ keepSelection: true })
    advance()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    decideLoading.value = false
  }
}

async function quickRemove(id: number) {
  if (!confirm('Remove this level from awaiting placement?')) return
  try {
    await $fetch(`/api/admin/awaiting/${id}`, { method: 'POST', body: { action: 'remove' } })
    if (selectedId.value === id) selectedId.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

function gdBrowserLink(id: number | null) { return id ? `https://gdbrowser.com/${id}` : null }

const placementHelperOpen = ref(false)
function onPlacementHelperPick(picked: { position: number; name: string; gddl_tier: string | null; difficulty: string | null }) {
  placement.value = String(picked.position + 1)
  if (picked.gddl_tier) tierOverride.value = picked.gddl_tier
  if (picked.difficulty) difficultyOverride.value = picked.difficulty
}

function onFlagsDuplicatePick(lvl: { id?: number; position: number; name: string; gddl_tier: string | null; difficulty: string | null }) {
  duplicateOfId.value = lvl.id ?? null
  draftDuplicateOf.value = { position: lvl.position, name: lvl.name }
}
function onFlagsAlternatePick(lvl: { id?: number; position: number; name: string; gddl_tier: string | null; difficulty: string | null }) {
  alternateOfId.value = lvl.id ?? null
  draftAlternateOf.value = { position: lvl.position, name: lvl.name }
}

const tierOverride = ref('')
const difficultyOverride = ref('')

const submitAllLoading = ref(false)
async function submitAllPending() {
  if (submitAllLoading.value) return
  if (!confirm('Place all awaiting levels (with a placement suggestion) and approve all pending movements?')) return
  submitAllLoading.value = true
  try {
    const res = await $fetch<{ placed: number; moved: number }>('/api/admin/submit-all', { method: 'POST' })
    flash('ok', `Done — ${res.placed} level${res.placed === 1 ? '' : 's'} placed, ${res.moved} movement${res.moved === 1 ? '' : 's'} approved.`)
    selectedId.value = null
    placement.value = ''
    preview.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    submitAllLoading.value = false
  }
}

const editingVideo = ref(false)
const editVideoUrl = ref('')
function startEditVideo() {
  editVideoUrl.value = selected.value?.verification_url ?? ''
  editingVideo.value = true
}
async function saveVideoUrl() {
  if (!selected.value) return
  try {
    await $fetch(`/api/admin/awaiting/${selected.value.id}`, {
      method: 'POST',
      body: { action: 'update_video', verification_url: editVideoUrl.value.trim() || null },
    })
    selected.value = { ...selected.value, verification_url: editVideoUrl.value.trim() || null }
    editingVideo.value = false
    flash('ok', 'Video link updated.')
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? 'Failed to update video link.')
  }
}

watch(preview, (p) => {
  if (!p) return
  const above = p.above[p.above.length - 1]
  if (above?.gddl_tier) tierOverride.value = above.gddl_tier
  if (above?.difficulty) difficultyOverride.value = above.difficulty
})

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
</script>

<template>
  <div class="grid grid-cols-[20%_55%_25%] grid-rows-[minmax(0,1fr)] h-full">
    <!-- Left: awaiting list -->
    <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
      <div class="p-3 border-b border-zinc-800 shrink-0 space-y-2">
        <div class="flex items-baseline justify-between">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Awaiting placement</p>
          <p class="text-[11px] text-zinc-600">
            {{ filteredItems.length }}<span v-if="filteredItems.length !== items.length"> / {{ items.length }}</span> unplaced
          </p>
        </div>
        <input
          v-model="search"
          type="search"
          placeholder="Search name, ID, tier…"
          class="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          :disabled="submitAllLoading"
          class="w-full rounded bg-emerald-700 hover:bg-emerald-600 text-zinc-100 font-medium text-xs py-1.5 transition-colors disabled:opacity-60"
          title="Place all awaiting levels that have a placement suggestion, and approve all pending movements."
          @click="submitAllPending"
        >{{ submitAllLoading ? 'Submitting…' : 'Submit all pending changes' }}</button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <ul v-if="filteredItems.length" class="divide-y divide-zinc-900/60">
          <li v-for="r in filteredItems" :key="r.id" class="relative group/li">
            <button
              type="button"
              class="w-full text-left px-3 py-2 pr-8 text-sm transition-colors"
              :class="selectedId === r.id ? 'bg-sky-900/30 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/70'"
              @click="selectedId = r.id"
            >
              <div class="font-medium truncate">{{ r.name }}</div>
              <div class="text-[11px] text-zinc-500 truncate">
                #{{ r.gd_id ?? '?' }} · {{ r.gddl_tier ?? r.difficulty ?? '—' }}
              </div>
              <div class="text-[10px] text-zinc-600 truncate">{{ r.approved_at }}</div>
            </button>
            <button
              type="button"
              class="absolute top-2 right-2 p-0.5 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover/li:opacity-100"
              title="Remove from awaiting"
              @click.stop="quickRemove(r.id)"
            >✕</button>
          </li>
        </ul>
        <div v-else-if="items.length" class="px-3 py-6 text-xs text-zinc-500 text-center">No matches in {{ items.length }} unplaced.</div>
        <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">Nothing awaiting placement.</div>
      </div>
    </aside>

    <!-- Center: level details -->
    <section class="overflow-y-auto min-h-0 px-6 py-6">
      <div v-if="!selected" class="text-center text-sm text-zinc-500 py-12">
        {{ items.length === 0 ? 'Nothing to place.' : 'Pick a level on the left.' }}
      </div>
      <div v-else class="max-w-2xl mx-auto space-y-5">
        <header>
          <h2 class="text-2xl font-semibold tracking-tight">{{ selected.name }}</h2>
          <p class="text-xs text-zinc-500 mt-1">
            <template v-if="selected.submitter">
              Submitted by
              <NuxtLink :to="`/users/${selected.submitter}`" class="hover:text-accent">{{ selected.submitter }}</NuxtLink> ·
            </template>
            Approved {{ selected.approved_at }}
          </p>
        </header>

        <!-- Stats grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
            <a v-if="gdBrowserLink(selected.gd_id)" :href="gdBrowserLink(selected.gd_id)!" target="_blank" rel="noopener" class="tabular-nums text-sm text-zinc-100 hover:text-accent">{{ selected.gd_id }}</a>
            <div v-else class="text-zinc-600">—</div>
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
            <dt class="text-zinc-500 self-center">Link</dt>
            <dd class="text-zinc-200 min-w-0">
              <template v-if="editingVideo">
                <div class="flex items-center gap-2">
                  <input
                    v-model="editVideoUrl"
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    class="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button type="button" class="shrink-0 rounded bg-accent text-zinc-950 font-medium text-xs px-2.5 py-1 hover:bg-accent/90 transition-colors" @click="saveVideoUrl">Save</button>
                  <button type="button" class="shrink-0 text-xs text-zinc-400 hover:text-zinc-200 px-1" @click="editingVideo = false">Cancel</button>
                </div>
              </template>
              <template v-else>
                <div class="flex items-center gap-2 min-w-0">
                  <a v-if="selected.verification_url" :href="selected.verification_url" target="_blank" rel="noopener" class="text-accent hover:underline break-all truncate flex-1">{{ selected.verification_url }}</a>
                  <span v-else class="text-zinc-600 flex-1">—</span>
                  <button type="button" class="shrink-0 text-[10px] uppercase tracking-widest text-zinc-500 hover:text-accent border border-zinc-800 hover:border-accent/60 rounded px-1.5 py-0.5 transition-colors" @click="startEditVideo">Edit</button>
                </div>
              </template>
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
        <div
          v-if="banner"
          class="rounded border px-3 py-2 text-xs"
          :class="banner.kind === 'ok' ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300' : 'border-red-900/50 bg-red-950/30 text-red-300'"
        >{{ banner.msg }}</div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Placement</p>
          <div class="flex items-center gap-1.5">
            <input
              v-model="placement"
              type="number" inputmode="numeric" min="1"
              placeholder="position #"
              class="flex-1 min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              class="shrink-0 rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1.5 transition-colors"
              @click="placementHelperOpen = true"
            >Helper…</button>
          </div>
          <div class="flex items-center gap-2 mt-1">
            <p v-if="selected?.placement_suggestion != null" class="text-[10px] text-accent">
              Pre-filled from suggestion #{{ selected.placement_suggestion }}.
            </p>
            <p v-if="placementSaved" class="text-[10px] text-emerald-400">Saved</p>
          </div>
          <p class="text-[10px] text-zinc-500 mt-1">
            Position in the main list. Existing levels at and below shift down by one.
          </p>
        </div>

        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">GDDL Tier <span class="text-zinc-600 normal-case">— auto-filled from level above</span></span>
          <input
            v-model="tierOverride"
            type="text"
            placeholder="e.g. Tier 15"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty <span class="text-zinc-600 normal-case">— auto-filled from level above</span></span>
          <input
            v-model="difficultyOverride"
            type="text"
            placeholder="e.g. Extreme Demon"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <!-- Flags: duplicate + alternate -->
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
            </span>
            <svg :class="{ 'rotate-180': flagsOpen }" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="flagsOpen" class="px-3 pb-3 space-y-3">
            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none pt-1">
              <input v-model="isDuplicate" type="checkbox" class="mt-0.5 accent-accent" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Duplicate (same difficulty as above)</span>
                <span class="text-zinc-500 normal-case">— inherits the previous level's points.</span>
                <span v-if="selected?.same_as_above" class="text-accent ml-1">Submitter requested this.</span>
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
                  @click="draftDuplicateOf = null; duplicateOfId = null"
                >clear</button>
              </div>
            </div>
            <label class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none">
              <input v-model="isAlternate" type="checkbox" class="mt-0.5 accent-accent" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Alternate</span>
                <span class="text-zinc-500 normal-case">— related variation; doesn't affect points.</span>
                <span v-if="selected?.is_alternate" class="text-accent ml-1">Submitter requested this.</span>
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
                  @click="draftAlternateOf = null; alternateOfId = null"
                >clear</button>
              </div>
            </div>
            <label
              class="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer select-none"
              title="Levels that do not have concrete estimations, leaving their placement on the List somewhat inaccurate."
            >
              <input v-model="isTentative" type="checkbox" class="mt-0.5 accent-yellow-400" />
              <span>
                <span class="block uppercase tracking-widest text-[11px] text-zinc-500">Tentative placement</span>
                <span class="text-zinc-500 normal-case">— shown as a yellow tag when this level's position is uncertain.</span>
              </span>
            </label>
          </div>
        </div>

        <!-- Preview rows around the candidate placement -->
        <div>
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
              <span class="truncate flex-1 italic">← placing here</span>
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

        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Reason for removal <span class="text-zinc-600 normal-case">sent to submitter</span></span>
          <textarea
            v-model="removeReason"
            rows="2"
            maxlength="4000"
            placeholder="Why this is being removed."
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>
      <!-- Sticky action footer: stays visible regardless of how tall the
           scroll area above grows, so Place / Return / Remove are always
           reachable without scrolling. -->
      <div v-if="selected" class="shrink-0 border-t border-zinc-800 bg-zinc-950 p-3 flex flex-col gap-2">
        <button
          type="button"
          :disabled="decideLoading || !placement"
          class="w-full rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-medium text-sm py-2 transition-colors disabled:opacity-60"
          @click="decide('place')"
        >Place at #{{ placement || '—' }}</button>
        <button
          type="button"
          :disabled="decideLoading"
          class="w-full rounded border border-zinc-700 hover:border-sky-600 hover:text-sky-300 text-sm py-2 transition-colors disabled:opacity-60"
          @click="returnToLevels"
          title="Send back to the levels (pending) tab."
        >Return to levels tab</button>
        <button
          type="button"
          :disabled="decideLoading"
          class="w-full rounded border border-zinc-700 hover:border-red-600 hover:text-red-400 text-sm py-2 transition-colors disabled:opacity-60"
          @click="decide('remove')"
          title="Remove from awaiting without placing on the list."
        >Remove</button>
      </div>
      <div v-if="!selected" class="p-4">
        <p class="text-xs text-zinc-500">Select a level to place.</p>
      </div>
    </aside>
  </div>

  <LevelComparisonDrawer
    v-model:open="placementHelperOpen"
    title="Placement helper"
    hint="Click a level to place the awaiting level right below it."
    :confirmOnPick="true"
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
</template>

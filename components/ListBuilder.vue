<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import type { BuilderItem } from '~/composables/useListBuilder'

/**
 * The home-page list builder: a searchable ALL-list palette on the left that
 * you drag levels out of, and your own ordered list on the right that you can
 * reorder by dragging. Rows can also be typed in by hand for levels that
 * aren't on the ALL list.
 */
const { draft, restore, persist, reset, loadFrom } = useListBuilder()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

onMounted(restore)
watch(draft, persist, { deep: true })

// --- Palette (searchable ALL levels) ---
type PaletteLevel = {
  id: number
  position: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  difficulty: string | null
  creator?: string | null
  sheet_placement?: number | null
}
const search = ref('')
const palette = ref<PaletteLevel[]>([])
const paletteLoading = ref(false)
const paletteTotal = ref(0)

let paletteCtrl: AbortController | null = null
async function loadPalette() {
  paletteLoading.value = true
  paletteCtrl?.abort()
  const ctrl = new AbortController()
  paletteCtrl = ctrl
  try {
    const res = await $fetch<{ total: number; items: PaletteLevel[] }>('/api/levels', {
      query: { page: 1, pageSize: 60, search: search.value || undefined },
      signal: ctrl.signal,
    })
    if (paletteCtrl !== ctrl) return
    palette.value = res.items
    paletteTotal.value = res.total
  } catch (e: any) {
    if (e?.name !== 'AbortError' && e?.cause?.name !== 'AbortError') throw e
  } finally {
    if (paletteCtrl === ctrl) { paletteLoading.value = false; paletteCtrl = null }
  }
}
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(loadPalette, 300)
})
// Fetched during setup (not onMounted) so the palette is server-rendered and
// the page doesn't paint an empty column first — same pattern as LevelListNav.
// Swallowed on failure: the palette is one column of the home page, and losing
// it shouldn't take the whole page down with it.
await loadPalette().catch(() => {})

function toItem(l: PaletteLevel): BuilderItem {
  return {
    level_id: l.id,
    name: l.name,
    gd_id: l.gd_id ?? null,
    creator: l.creator ?? null,
    difficulty: l.difficulty ?? null,
    gddl_tier: l.gddl_tier ?? null,
    verification_url: null,
    notes: null,
    position: l.position,
    sheet_placement: l.sheet_placement ?? null,
  }
}

const alreadyAdded = computed(() => new Set(draft.value.items.map((i) => i.level_id).filter(Boolean)))

function addLevel(l: PaletteLevel, at?: number) {
  const item = toItem(l)
  if (at == null || at >= draft.value.items.length) draft.value.items.push(item)
  else draft.value.items.splice(Math.max(0, at), 0, item)
}

// --- Drag & drop ---
// dragKind distinguishes "new level from the palette" from "reorder an
// existing row"; dragIndex is the row being reordered.
const dragKind = ref<'palette' | 'item' | null>(null)
const dragLevel = ref<PaletteLevel | null>(null)
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function onPaletteDragStart(e: DragEvent, l: PaletteLevel) {
  dragKind.value = 'palette'
  dragLevel.value = l
  dragIndex.value = null
  e.dataTransfer?.setData('text/plain', l.name)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}
function onItemDragStart(e: DragEvent, index: number) {
  dragKind.value = 'item'
  dragIndex.value = index
  dragLevel.value = null
  e.dataTransfer?.setData('text/plain', String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOverSlot(e: DragEvent, index: number) {
  if (!dragKind.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = dragKind.value === 'palette' ? 'copy' : 'move'
  dropIndex.value = index
}
function onDropSlot(e: DragEvent, index: number) {
  e.preventDefault()
  if (dragKind.value === 'palette' && dragLevel.value) {
    addLevel(dragLevel.value, index)
  } else if (dragKind.value === 'item' && dragIndex.value != null) {
    const from = dragIndex.value
    // Removing the source first shifts every later target left by one.
    const to = index > from ? index - 1 : index
    const [moved] = draft.value.items.splice(from, 1)
    if (moved) draft.value.items.splice(to, 0, moved)
  }
  endDrag()
}
function endDrag() {
  dragKind.value = null
  dragLevel.value = null
  dragIndex.value = null
  dropIndex.value = null
}

function move(index: number, delta: number) {
  const to = index + delta
  if (to < 0 || to >= draft.value.items.length) return
  const [item] = draft.value.items.splice(index, 1)
  if (item) draft.value.items.splice(to, 0, item)
}
function removeAt(index: number) {
  draft.value.items.splice(index, 1)
}

// --- Manual entry ---
const settingsOpen = ref(false)
// Which row has its list-metadata editor (verifier / % to qualify / FPS) open.
const metaOpen = ref<number | null>(null)
const manualOpen = ref(false)
const manual = reactive<{ name: string; gd_id: string; creator: string; difficulty: string; gddl_tier: string; verification_url: string; notes: string }>({
  name: '', gd_id: '', creator: '', difficulty: '', gddl_tier: '', verification_url: '', notes: '',
})
function addManual() {
  const name = manual.name.trim()
  if (!name) return
  draft.value.items.push({
    level_id: null,
    name,
    gd_id: manual.gd_id.trim() ? Number(manual.gd_id.trim()) : null,
    creator: manual.creator.trim() || null,
    difficulty: manual.difficulty.trim() || null,
    gddl_tier: manual.gddl_tier.trim() || null,
    verification_url: manual.verification_url.trim() || null,
    notes: manual.notes.trim() || null,
  })
  manual.name = ''; manual.gd_id = ''; manual.creator = ''
  manual.difficulty = ''; manual.gddl_tier = ''; manual.verification_url = ''; manual.notes = ''
  manualOpen.value = false
}

// --- Saving ---
const saving = ref(false)
const saveError = ref<string | null>(null)
const saveOk = ref(false)
const shareUrl = computed(() =>
  draft.value.publicId && import.meta.client
    ? `${window.location.origin}/lists/${draft.value.publicId}`
    : null,
)

async function save() {
  if (saving.value) return
  if (!me.value) { saveError.value = 'Log in to save this list.'; return }
  if (draft.value.items.length === 0) { saveError.value = 'Add at least one level first.'; return }
  saving.value = true
  saveError.value = null
  saveOk.value = false
  try {
    const payload = {
      title: draft.value.title,
      description: draft.value.description,
      is_public: draft.value.isPublic,
      accepts_records: draft.value.acceptsRecords,
      max_points: draft.value.maxPoints,
      min_points: draft.value.minPoints,
      scored_count: draft.value.scoredCount,
      items: draft.value.items.map((i) => ({
        id: i.id ?? null,
        level_id: i.level_id,
        name: i.name,
        gd_id: i.gd_id,
        creator: i.creator,
        difficulty: i.difficulty,
        gddl_tier: i.gddl_tier,
        verification_url: i.verification_url,
        notes: i.notes,
        verifier: i.verifier ?? null,
        percent_to_qualify: i.percent_to_qualify ?? 100,
        fps: i.fps ?? null,
        game_version: i.game_version ?? null,
      })),
    }
    const res = draft.value.publicId
      ? await $fetch<{ list: any }>(`/api/custom-lists/${draft.value.publicId}`, { method: 'PATCH', body: payload })
      : await $fetch<{ list: any }>('/api/custom-lists', { method: 'POST', body: payload })
    // Reload from the saved list so every row carries its database id. Without
    // that, the next save can't tell the server which existing rows these are,
    // and reordering would drop the records attached to them.
    loadFrom(res.list)
    saveOk.value = true
    await loadMyLists()
    setTimeout(() => { saveOk.value = false }, 3000)
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? 'Failed to save.'
  } finally {
    saving.value = false
  }
}

function startNew() {
  if (draft.value.items.length && !confirm('Clear the current list and start a new one?')) return
  reset()
}

// --- My saved lists ---
type SavedList = { id: number; public_id: string; title: string; item_count: number; updated_at: string }
const myLists = ref<SavedList[]>([])
async function loadMyLists() {
  if (!me.value) { myLists.value = []; return }
  try {
    const res = await $fetch<{ lists: SavedList[] }>('/api/custom-lists')
    myLists.value = res.lists
  } catch { myLists.value = [] }
}
watch(me, loadMyLists, { immediate: true })

async function openList(publicId: string) {
  try {
    const res = await $fetch<{ list: any }>(`/api/custom-lists/${publicId}`)
    loadFrom(res.list)
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? 'Failed to open list.'
  }
}
async function deleteList(l: SavedList) {
  if (!confirm(`Delete "${l.title}"?`)) return
  try {
    await $fetch(`/api/custom-lists/${l.public_id}`, { method: 'DELETE' })
    if (draft.value.publicId === l.public_id) draft.value.publicId = null
    await loadMyLists()
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? 'Failed to delete.'
  }
}

const copied = ref(false)
function copyShare() {
  if (!shareUrl.value) return
  navigator.clipboard.writeText(shareUrl.value).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  }).catch(() => {})
}
</script>

<template>
  <div class="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] items-start">
    <!-- ── Palette ────────────────────────────────────────────────── -->
    <aside class="rounded-xl border border-zinc-800 bg-zinc-950/70 overflow-hidden lg:sticky lg:top-20">
      <div class="px-4 py-3 border-b border-zinc-800/80">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">Drag from the ALL list</h2>
        <input
          v-model="search"
          type="search"
          placeholder="Search levels…"
          class="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <ul class="max-h-[28rem] overflow-y-auto p-1.5 space-y-1">
        <li v-for="l in palette" :key="l.id">
          <div
            draggable="true"
            class="relative overflow-hidden flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing group ring-1 ring-inset ring-transparent hover:ring-zinc-700/60 transition-all"
            :class="alreadyAdded.has(l.id) ? 'opacity-45' : ''"
            @dragstart="onPaletteDragStart($event, l)"
            @dragend="endDrag"
          >
            <LevelThumbBg
              :gd-id="l.gd_id"
              :video-url="l.verification_url"
              res="small"
              img-class="opacity-25 group-hover:opacity-50"
              overlay-class="bg-gradient-to-r from-zinc-950/90 via-zinc-950/60 to-zinc-950/20"
            />
            <span
              class="relative text-[10px] tabular-nums px-1 py-0.5 w-12 shrink-0 text-center font-semibold rounded"
              :style="{ backgroundColor: tierColor(l.gddl_tier), color: textOn(tierColor(l.gddl_tier)) }"
            >#{{ l.sheet_placement ?? l.position }}</span>
            <span class="relative truncate flex-1 text-sm text-zinc-200 font-medium">{{ l.name }}</span>
            <button
              type="button"
              class="relative shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-accent hover:bg-zinc-800 transition-colors"
              title="Add to list"
              @click="addLevel(l)"
            >+</button>
          </div>
        </li>
        <li v-if="paletteLoading" class="px-3 py-4 text-center text-xs text-zinc-600">loading…</li>
        <li v-else-if="palette.length === 0" class="px-3 py-4 text-center text-xs text-zinc-600">No matches.</li>
      </ul>
      <div class="px-4 py-2 border-t border-zinc-800/80 text-[10px] text-zinc-600 tabular-nums">
        {{ paletteTotal.toLocaleString() }} levels — showing top {{ palette.length }}
      </div>
    </aside>

    <!-- ── The list being built ───────────────────────────────────── -->
    <section class="rounded-xl border border-zinc-800 bg-zinc-950/70 overflow-hidden">
      <div class="px-4 py-3 border-b border-zinc-800/80 flex flex-wrap items-center gap-2">
        <input
          v-model="draft.title"
          type="text"
          maxlength="120"
          placeholder="List title"
          class="flex-1 min-w-[12rem] bg-transparent text-lg font-semibold tracking-tight text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
        <span class="text-[11px] text-zinc-500 tabular-nums">{{ draft.items.length }} level{{ draft.items.length === 1 ? '' : 's' }}</span>
        <button
          type="button"
          class="rounded-lg border border-zinc-700 text-zinc-300 text-xs px-2.5 py-1 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          @click="startNew"
        >New</button>
        <button
          type="button"
          :disabled="saving"
          class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1 hover:bg-accent/90 disabled:opacity-60 transition-colors"
          @click="save"
        >{{ saving ? 'Saving…' : draft.publicId ? 'Save changes' : 'Save list' }}</button>
      </div>

      <div class="px-4 py-2 border-b border-zinc-800/80 flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          v-model="draft.description"
          type="text"
          maxlength="2000"
          placeholder="Optional description…"
          class="flex-1 min-w-[12rem] bg-transparent text-xs text-zinc-400 placeholder:text-zinc-600 focus:outline-none"
        />
        <label class="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer select-none shrink-0" title="Show this list in the public gallery">
          <input v-model="draft.isPublic" type="checkbox" class="accent-accent" />
          Public
        </label>
        <span v-if="saveOk" class="text-[11px] text-emerald-400">Saved ✓</span>
        <span v-if="saveError" class="text-[11px] text-red-400">{{ saveError }}</span>
        <button
          v-if="shareUrl"
          type="button"
          class="text-[11px] text-zinc-500 hover:text-accent transition-colors"
          @click="copyShare"
        >{{ copied ? 'Link copied ✓' : 'Copy share link' }}</button>
        <button
          type="button"
          class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors shrink-0"
          @click="settingsOpen = !settingsOpen"
        >{{ settingsOpen ? 'Hide settings' : 'List settings' }}</button>
      </div>

      <!-- List settings: how the list scores and whether it takes records -->
      <div v-if="settingsOpen" class="px-4 py-3 border-b border-zinc-800/80 grid gap-3 sm:grid-cols-4">
        <label class="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none sm:col-span-4">
          <input v-model="draft.acceptsRecords" type="checkbox" class="accent-accent" />
          Accept record submissions — players can submit completions and appear on this list's leaderboard
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Points at #1</span>
          <input v-model.number="draft.maxPoints" inputmode="decimal" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Points at the bottom</span>
          <input v-model.number="draft.minPoints" inputmode="decimal" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Scored levels</span>
          <input v-model.number="draft.scoredCount" inputmode="numeric" placeholder="0 = all" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <p class="text-[10px] text-zinc-600 self-end pb-1.5">
          Points decay smoothly from #1 down to the last scored level.
        </p>
      </div>

      <!-- Rows -->
      <ol v-if="draft.items.length" class="p-2 space-y-1" @dragover.prevent @drop.prevent>
        <template v-for="(item, i) in draft.items" :key="`${item.level_id ?? 'custom'}-${i}`">
          <!-- Drop slot above each row -->
          <li
            class="h-1.5 -my-0.5 rounded transition-all"
            :class="dropIndex === i && dragKind ? 'h-6 bg-accent/25 ring-1 ring-accent/60' : ''"
            @dragover="onDragOverSlot($event, i)"
            @drop="onDropSlot($event, i)"
          />
          <li
            draggable="true"
            class="relative overflow-hidden flex items-center gap-2.5 pl-1.5 pr-2 py-2 rounded-lg group ring-1 ring-inset ring-zinc-800/70 hover:ring-zinc-700 bg-zinc-900/30 cursor-grab active:cursor-grabbing transition-all"
            :class="dragKind === 'item' && dragIndex === i ? 'opacity-40' : ''"
            @dragstart="onItemDragStart($event, i)"
            @dragend="endDrag"
          >
            <LevelThumbBg
              :gd-id="item.gd_id"
              :video-url="item.verification_url"
              res="small"
              img-class="opacity-25 group-hover:opacity-45"
              overlay-class="bg-gradient-to-r from-zinc-950/90 via-zinc-950/60 to-zinc-950/25"
            />
            <span class="relative shrink-0 w-8 text-center tabular-nums text-sm font-bold text-accent">{{ i + 1 }}</span>
            <span
              v-if="item.gddl_tier"
              class="relative shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
              :style="{ backgroundColor: tierColor(item.gddl_tier), color: textOn(tierColor(item.gddl_tier)) }"
            >{{ item.gddl_tier }}</span>
            <div class="relative flex-1 min-w-0">
              <NuxtLink
                v-if="item.position"
                :to="`/levels/${item.position}`"
                class="block truncate text-sm font-medium text-zinc-100 hover:text-accent transition-colors"
              >{{ item.name }}</NuxtLink>
              <span v-else class="block truncate text-sm font-medium text-zinc-100">{{ item.name }}</span>
              <span v-if="item.creator || item.notes" class="block truncate text-[11px] text-zinc-500">
                <template v-if="item.creator">{{ item.creator }}</template>
                <template v-if="item.creator && item.notes"> · </template>
                <template v-if="item.notes">{{ item.notes }}</template>
              </span>
            </div>
            <span v-if="item.position" class="relative shrink-0 text-[10px] text-zinc-600 tabular-nums">ALL #{{ item.sheet_placement ?? item.position }}</span>
            <span v-else class="relative shrink-0 text-[10px] text-zinc-600 uppercase tracking-wider">custom</span>
            <div class="relative shrink-0 flex items-center gap-0.5 transition-opacity" :class="metaOpen === i ? '' : 'opacity-0 group-hover:opacity-100'">
              <button
                type="button"
                class="w-6 h-6 rounded transition-colors"
                :class="metaOpen === i ? 'text-accent bg-accent/10' : 'text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800'"
                title="Level details (verifier, percent to qualify, FPS)"
                @click="metaOpen = metaOpen === i ? null : i"
              >⋯</button>
              <button type="button" class="w-6 h-6 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors" title="Move up" @click="move(i, -1)">↑</button>
              <button type="button" class="w-6 h-6 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors" title="Move down" @click="move(i, 1)">↓</button>
              <button type="button" class="w-6 h-6 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors" title="Remove" @click="removeAt(i)">✕</button>
            </div>
          </li>
          <!-- Per-level list metadata -->
          <li v-if="metaOpen === i" class="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3 grid gap-2 sm:grid-cols-4">
            <label class="block sm:col-span-2">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verifier</span>
              <input v-model="item.verifier" type="text" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">% to qualify</span>
              <input v-model.number="item.percent_to_qualify" inputmode="numeric" placeholder="100" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">FPS</span>
              <input v-model="item.fps" type="text" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block sm:col-span-2">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verification video</span>
              <input v-model="item.verification_url" type="url" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Game version</span>
              <input v-model="item.game_version" type="text" placeholder="2.2" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label class="block">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Note</span>
              <input v-model="item.notes" type="text" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <p v-if="item.level_id" class="text-[10px] text-zinc-600 sm:col-span-4">
              Name, creator and tier come from the ALL list for linked levels and can't be overridden here.
            </p>
          </li>
        </template>
        <!-- Trailing drop slot -->
        <li
          class="rounded transition-all"
          :class="dropIndex === draft.items.length && dragKind ? 'h-8 bg-accent/25 ring-1 ring-accent/60' : 'h-3'"
          @dragover="onDragOverSlot($event, draft.items.length)"
          @drop="onDropSlot($event, draft.items.length)"
        />
      </ol>

      <div
        v-else
        class="m-3 rounded-xl border-2 border-dashed border-zinc-800 px-6 py-12 text-center transition-colors"
        :class="dragKind ? 'border-accent/60 bg-accent/5' : ''"
        @dragover="onDragOverSlot($event, 0)"
        @drop="onDropSlot($event, 0)"
      >
        <p class="text-sm text-zinc-400 font-medium">Drag levels here to start your list</p>
        <p class="text-xs text-zinc-600 mt-1.5">…or add one that isn't on the ALL list below.</p>
      </div>

      <!-- Manual entry -->
      <div class="border-t border-zinc-800/80">
        <button
          type="button"
          class="w-full px-4 py-2.5 text-left text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60 transition-colors flex items-center justify-between"
          @click="manualOpen = !manualOpen"
        >
          <span>Add a custom level</span>
          <span class="text-zinc-600 transition-transform inline-block" :class="manualOpen ? 'rotate-180' : ''">▾</span>
        </button>
        <div v-if="manualOpen" class="px-4 pb-4 grid gap-2 sm:grid-cols-2">
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Level name *</span>
            <input v-model="manual.name" type="text" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" @keydown.enter.prevent="addManual" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Level ID</span>
            <input v-model="manual.gd_id" inputmode="numeric" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Creator</span>
            <input v-model="manual.creator" type="text" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty</span>
            <input v-model="manual.difficulty" type="text" placeholder="Extreme Demon" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Tier</span>
            <input v-model="manual.gddl_tier" type="text" placeholder="Tier 20" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verification URL</span>
            <input v-model="manual.verification_url" type="url" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Note</span>
            <input v-model="manual.notes" type="text" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <div class="sm:col-span-2">
            <button
              type="button"
              :disabled="!manual.name.trim()"
              class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-40 transition-colors"
              @click="addManual"
            >Add to list</button>
          </div>
        </div>
      </div>

      <!-- Saved lists -->
      <div v-if="me" class="border-t border-zinc-800/80 px-4 py-3">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">Your saved lists</h3>
        <p v-if="myLists.length === 0" class="text-xs text-zinc-600">Nothing saved yet.</p>
        <ul v-else class="space-y-1">
          <li v-for="l in myLists" :key="l.public_id" class="flex items-center gap-2 text-sm">
            <button type="button" class="flex-1 text-left truncate text-zinc-300 hover:text-accent transition-colors" @click="openList(l.public_id)">
              {{ l.title }}
            </button>
            <span class="text-[10px] text-zinc-600 tabular-nums shrink-0">{{ l.item_count }}</span>
            <NuxtLink :to="`/lists/${l.public_id}`" class="text-[10px] text-zinc-600 hover:text-accent shrink-0">view</NuxtLink>
            <button type="button" class="text-[10px] text-zinc-700 hover:text-red-400 shrink-0" @click="deleteList(l)">delete</button>
          </li>
        </ul>
      </div>
      <div v-else class="border-t border-zinc-800/80 px-4 py-3">
        <p class="text-xs text-zinc-500">
          Your draft is kept in this browser.
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>
          to save and share it.
        </p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * Drag-to-place editor for moderators. Shows a window of the list around the
 * level being moved; drag it up or down to the slot you want and hit Apply.
 *
 * Nothing is written until Apply — dragging only reorders a local copy, so a
 * mis-drop costs nothing. Apply issues the same single move request the
 * numeric "move to position" control uses.
 */
const props = defineProps<{
  open: boolean
  /** The level being repositioned. */
  position: number
  name: string
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'moved'): void
}>()

type Row = {
  position: number
  sheet_placement: number | null
  name: string
  gd_id: number | null
  gddl_tier: string | null
  verification_url?: string | null
}

/**
 * How many levels to show on each side of the level being moved. Wide enough
 * that most moves land without leaving the window; "Show more" extends it in
 * the same increment when they don't.
 */
const WINDOW = 40
const EXTEND_BY = 60

const rows = ref<Row[]>([])
const loading = ref(false)
const extending = ref(false)
const error = ref<string | null>(null)
const applying = ref(false)
// Position of the window's first row, so a local index maps back to a real
// list position.
const windowStart = ref(1)
/** Half-width of the currently loaded window; grows via "Show more". */
const span = ref(WINDOW)
const scrollEl = ref<HTMLElement | null>(null)

async function load(opts: { keepScroll?: boolean } = {}) {
  const setBusy = opts.keepScroll ? extending : loading
  setBusy.value = true
  error.value = null
  const prevHeight = scrollEl.value?.scrollHeight ?? 0
  const prevTop = scrollEl.value?.scrollTop ?? 0
  try {
    const start = Math.max(1, props.position - span.value)
    const res = await $fetch<{ items: Row[] }>('/api/levels', {
      query: { page: 1, pageSize: span.value * 2 + 1, fromPosition: start },
    })
    rows.value = res.items
    windowStart.value = res.items[0]?.position ?? start
    await nextTick()
    if (opts.keepScroll && scrollEl.value) {
      // Rows were prepended above; hold the viewport where the user left it.
      scrollEl.value.scrollTop = prevTop + (scrollEl.value.scrollHeight - prevHeight)
    } else {
      scrollToMoving()
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not load the surrounding levels.'
  } finally {
    setBusy.value = false
  }
}

async function showMore() {
  if (extending.value) return
  span.value += EXTEND_BY
  await load({ keepScroll: true })
}

/** Centre the dragged row so it's always in view when the dialog opens. */
async function scrollToMoving() {
  await nextTick()
  scrollEl.value?.querySelector<HTMLElement>('[data-moving="1"]')
    ?.scrollIntoView({ block: 'center' })
}

watch(() => props.open, (open) => { if (open) { span.value = WINDOW; load() } }, { immediate: true })
watch(() => props.position, () => { if (props.open) { span.value = WINDOW; load() } })

const movingIndex = computed(() => rows.value.findIndex((r) => r.position === props.position))

// --- Drag reorder over the local copy ---
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function onDragStart(e: DragEvent, i: number) {
  dragIndex.value = i
  dragBox = scrollEl.value?.getBoundingClientRect() ?? null
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer?.setData('text/plain', String(i))
}
function onDragOver(e: DragEvent, i: number) {
  if (dragIndex.value == null) return
  e.preventDefault()
  dropIndex.value = i
  autoScroll(e.clientY)
}

/**
 * Scroll the list while a drag hovers near its top or bottom edge. HTML5 drag
 * and drop suppresses normal scrolling, so without this a window taller than
 * the dialog can only be reordered as far as the visible rows.
 */
const EDGE_PX = 56
const MAX_STEP = 18
let scrollTimer: ReturnType<typeof setInterval> | null = null
let scrollStep = 0
// dragover fires continuously; reading the container's rect each time forces a
// layout on every event and is what made dragging feel like it was chugging.
// The container can't move during a drag, so measure once per drag instead.
let dragBox: DOMRect | null = null

function autoScroll(clientY: number) {
  const el = scrollEl.value
  if (!el) return
  const box = dragBox ?? (dragBox = el.getBoundingClientRect())
  const fromTop = clientY - box.top
  const fromBottom = box.bottom - clientY

  if (fromTop < EDGE_PX) scrollStep = -Math.ceil(((EDGE_PX - fromTop) / EDGE_PX) * MAX_STEP)
  else if (fromBottom < EDGE_PX) scrollStep = Math.ceil(((EDGE_PX - fromBottom) / EDGE_PX) * MAX_STEP)
  else scrollStep = 0

  if (scrollStep !== 0 && !scrollTimer) {
    scrollTimer = setInterval(() => {
      if (!scrollEl.value || scrollStep === 0) return
      scrollEl.value.scrollTop += scrollStep
    }, 16)
  } else if (scrollStep === 0) {
    stopAutoScroll()
  }
}

function stopAutoScroll() {
  if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null }
  scrollStep = 0
}

function endDrag() {
  dragIndex.value = null
  dropIndex.value = null
  dragBox = null
  stopAutoScroll()
}
onBeforeUnmount(stopAutoScroll)
function onDrop(e: DragEvent, i: number) {
  e.preventDefault()
  const from = dragIndex.value
  if (from != null) {
    const to = i > from ? i - 1 : i
    const next = [...rows.value]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    rows.value = next
  }
  endDrag()
}
function nudge(delta: number) {
  const i = movingIndex.value
  const to = i + delta
  if (i < 0 || to < 0 || to >= rows.value.length) return
  const next = [...rows.value]
  const [moved] = next.splice(i, 1)
  if (moved) next.splice(to, 0, moved)
  rows.value = next
}

/** The list position the dragged level would land on. */
const targetPosition = computed(() => {
  const i = movingIndex.value
  return i < 0 ? props.position : windowStart.value + i
})
const dirty = computed(() => targetPosition.value !== props.position)

/** The tier the level currently has, before any of this. */
const movingTier = computed(() => rows.value[movingIndex.value]?.gddl_tier ?? null)

/**
 * The tier the level takes by landing where it's been dragged to.
 *
 * Mirrors `tierForSlot` on the server — nearest tiered neighbour each side,
 * ties to the one above — so what the dialog promises is what the move does.
 * Computed from the rows already on screen; no extra request per drag.
 */
const keepTier = ref(false)
const landingTier = computed<string | null>(() => {
  const i = movingIndex.value
  if (i < 0) return null
  let above: { d: number; tier: string } | null = null
  for (let k = i - 1; k >= 0; k--) {
    const t = rows.value[k]?.gddl_tier
    if (t) { above = { d: i - k, tier: t }; break }
  }
  let below: { d: number; tier: string } | null = null
  for (let k = i + 1; k < rows.value.length; k++) {
    const t = rows.value[k]?.gddl_tier
    if (t) { below = { d: k - i, tier: t }; break }
  }
  if (!above && !below) return null
  if (!above) return below!.tier
  if (!below) return above.tier
  if (above.tier === below.tier) return above.tier
  return below.d < above.d ? below.tier : above.tier
})
/** Only worth saying when the move would actually change the label. */
const tierChanges = computed(
  () => dirty.value && !!landingTier.value && landingTier.value !== movingTier.value,
)

async function apply() {
  if (!dirty.value || applying.value) return
  applying.value = true
  error.value = null
  try {
    await $fetch(`/api/admin/levels/${props.position}/move`, {
      method: 'POST',
      body: { to: targetPosition.value, keep_tier: keepTier.value },
    })
    emit('moved')
    emit('update:open', false)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Move failed.'
  } finally {
    applying.value = false
  }
}

function close() { emit('update:open', false) }
function onEsc(e: KeyboardEvent) { if (e.key === 'Escape' && props.open) close() }
onMounted(() => window.addEventListener('keydown', onEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Drag to place level"
        class="relative w-full max-w-3xl h-[92vh] modal-panel flex flex-col"
      >
        <div class="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-zinc-100 truncate">Place “{{ name }}”</h2>
            <p class="text-[11px] text-zinc-500">Drag the highlighted row or use ↑ ↓. The list scrolls at the edges.</p>
          </div>
          <div class="ml-auto flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              class="w-7 h-7 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
              title="Move up"
              @click="nudge(-1)"
            >↑</button>
            <button
              type="button"
              class="w-7 h-7 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
              title="Move down"
              @click="nudge(1)"
            >↓</button>
            <button
              type="button"
              class="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              aria-label="Close"
              @click="close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-4 h-4">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto p-2">
          <p v-if="loading" class="py-10 text-center text-xs text-zinc-500">Loading…</p>
          <ul v-else class="space-y-0.5">
            <li v-if="windowStart > 1" class="pb-1">
              <button
                type="button"
                :disabled="extending"
                class="w-full rounded-lg border border-dashed border-zinc-800 text-[11px] text-zinc-500 py-1.5 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-50 transition-colors"
                @click="showMore"
              >{{ extending ? 'Loading…' : `Show ${EXTEND_BY} more above and below` }}</button>
            </li>
            <template v-for="(r, i) in rows" :key="r.position">
              <li
                class="rounded transition-all"
                :class="dropIndex === i && dragIndex != null ? 'h-6 bg-accent/25 ring-1 ring-accent/60' : 'h-1'"
                @dragover="onDragOver($event, i)"
                @drop="onDrop($event, i)"
              />
              <li
                :draggable="r.position === position"
                :data-moving="r.position === position ? '1' : undefined"
                class="relative overflow-hidden flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-lg text-sm group transition-all"
                :class="r.position === position
                  ? 'ring-2 ring-inset ring-accent bg-accent/10 cursor-grab active:cursor-grabbing text-zinc-50'
                  : 'text-zinc-400 ring-1 ring-inset ring-transparent'"
                @dragstart="onDragStart($event, i)"
                @dragend="endDrag"
              >
                <!-- Only the dragged row gets a thumbnail. Every row loading a
                     remote image turned opening this dialog into ~80 parallel
                     requests, and the surrounding rows are context, not the
                     subject. -->
                <LevelThumbBg
                  v-if="r.position === position"
                  :gd-id="r.gd_id"
                  :video-url="r.verification_url"
                  res="small"
                  img-class="opacity-45"
                  overlay-class="bg-gradient-to-r from-zinc-950/92 via-zinc-950/70 to-zinc-950/35"
                />
                <span
                  class="relative shrink-0 w-14 text-center text-[11px] tabular-nums px-1 py-0.5 rounded font-semibold"
                  :style="{ backgroundColor: tierColor(r.gddl_tier), color: textOn(tierColor(r.gddl_tier)) }"
                >#{{ r.sheet_placement ?? r.position }}</span>
                <span class="relative truncate flex-1">{{ r.name }}</span>
                <span
                  v-if="r.position === position"
                  class="relative shrink-0 text-[10px] uppercase tracking-widest text-accent"
                >dragging</span>
              </li>
            </template>
            <li
              class="rounded transition-all"
              :class="dropIndex === rows.length && dragIndex != null ? 'h-6 bg-accent/25 ring-1 ring-accent/60' : 'h-1'"
              @dragover="onDragOver($event, rows.length)"
              @drop="onDrop($event, rows.length)"
            />
          </ul>
        </div>

        <div class="px-4 py-3 border-t border-zinc-800 flex items-center gap-3 flex-wrap">
          <span class="text-[11px] text-zinc-500">
            <template v-if="dirty">
              Moving to list position <span class="text-accent tabular-nums font-semibold">#{{ targetPosition }}</span>
            </template>
            <template v-else>Drag the highlighted row to a new slot.</template>
          </span>

          <!-- The slot carries a tier, and the level takes it on landing.
               Shown live while dragging so it's never a surprise. -->
          <template v-if="tierChanges">
            <span class="text-[11px] text-zinc-500 flex items-center gap-1.5">
              <span
                v-if="movingTier"
                class="px-1.5 py-0.5 rounded text-[10px] font-semibold line-through decoration-zinc-500/70"
                :style="{ backgroundColor: tierColor(movingTier), color: textOn(tierColor(movingTier)) }"
              >{{ movingTier }}</span>
              <span aria-hidden="true">→</span>
              <span
                class="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                :style="{ backgroundColor: tierColor(landingTier), color: textOn(tierColor(landingTier)) }"
              >{{ landingTier }}</span>
            </span>
            <label class="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer select-none hover:text-zinc-300 transition-colors">
              <input v-model="keepTier" type="checkbox" class="accent-accent" />
              Keep {{ movingTier ?? 'its tier' }}
            </label>
          </template>

          <span v-if="error" class="text-[11px] text-red-400">{{ error }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              @click="close"
            >Cancel</button>
            <button
              type="button"
              :disabled="!dirty || applying"
              class="btn btn-sm btn-primary"
              @click="apply"
            >{{ applying ? 'Applying…' : 'Apply move' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

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
}

/** How many levels to show on each side of the level being moved. */
const WINDOW = 25

const rows = ref<Row[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const applying = ref(false)
// Position of the window's first row, so a local index maps back to a real
// list position.
const windowStart = ref(1)

async function load() {
  loading.value = true
  error.value = null
  try {
    const start = Math.max(1, props.position - WINDOW)
    const res = await $fetch<{ items: Row[] }>('/api/levels', {
      query: { page: 1, pageSize: WINDOW * 2 + 1, fromPosition: start },
    })
    rows.value = res.items
    windowStart.value = res.items[0]?.position ?? start
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not load the surrounding levels.'
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (open) => { if (open) load() }, { immediate: true })
watch(() => props.position, () => { if (props.open) load() })

const movingIndex = computed(() => rows.value.findIndex((r) => r.position === props.position))

// --- Drag reorder over the local copy ---
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function onDragStart(e: DragEvent, i: number) {
  dragIndex.value = i
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer?.setData('text/plain', String(i))
}
function onDragOver(e: DragEvent, i: number) {
  if (dragIndex.value == null) return
  e.preventDefault()
  dropIndex.value = i
}
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
  dragIndex.value = null
  dropIndex.value = null
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

async function apply() {
  if (!dirty.value || applying.value) return
  applying.value = true
  error.value = null
  try {
    await $fetch(`/api/admin/levels/${props.position}/move`, {
      method: 'POST',
      body: { to: targetPosition.value },
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
        class="relative w-full max-w-2xl max-h-[88vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col"
      >
        <div class="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-zinc-100 truncate">Place “{{ name }}”</h2>
            <p class="text-[11px] text-zinc-500">Drag the highlighted row, or use ↑ ↓, then apply.</p>
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

        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <p v-if="loading" class="py-10 text-center text-xs text-zinc-500">Loading…</p>
          <ul v-else class="space-y-0.5">
            <template v-for="(r, i) in rows" :key="r.position">
              <li
                class="rounded transition-all"
                :class="dropIndex === i && dragIndex != null ? 'h-6 bg-accent/25 ring-1 ring-accent/60' : 'h-1'"
                @dragover="onDragOver($event, i)"
                @drop="onDrop($event, i)"
              />
              <li
                :draggable="r.position === position"
                class="relative overflow-hidden flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-lg text-sm group transition-all"
                :class="r.position === position
                  ? 'ring-2 ring-inset ring-accent bg-accent/10 cursor-grab active:cursor-grabbing text-zinc-50'
                  : 'text-zinc-400 ring-1 ring-inset ring-transparent'"
                @dragstart="onDragStart($event, i)"
                @dragend="dragIndex = null; dropIndex = null"
              >
                <LevelThumbBg
                  :gd-id="r.gd_id"
                  res="small"
                  :img-class="r.position === position ? 'opacity-45' : 'opacity-15'"
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

        <div class="px-4 py-3 border-t border-zinc-800 flex items-center gap-3">
          <span class="text-[11px] text-zinc-500">
            <template v-if="dirty">
              Moving to list position <span class="text-accent tabular-nums font-semibold">#{{ targetPosition }}</span>
            </template>
            <template v-else>Drag the highlighted row to a new slot.</template>
          </span>
          <span v-if="error" class="text-[11px] text-red-400">{{ error }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-zinc-700 text-zinc-300 text-xs px-3 py-1.5 hover:border-zinc-500 transition-colors"
              @click="close"
            >Cancel</button>
            <button
              type="button"
              :disabled="!dirty || applying"
              class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-4 py-1.5 hover:bg-accent/90 disabled:opacity-40 transition-colors"
              @click="apply"
            >{{ applying ? 'Applying…' : 'Apply move' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

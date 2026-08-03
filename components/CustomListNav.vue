<script setup lang="ts">
import { textOn } from '~/utils/tier-colors'
import { listRowColors } from '~/utils/custom-list-colors'

/**
 * Left panel of a custom list: every level on the list, searchable, with
 * thumbnails — deliberately the same row shape as the main list's nav so
 * moving between the two feels like one site.
 *
 * Editors get a reorder mode on top of that: drag a row, or type a rank into
 * it, and the move is saved on drop. Nothing about the read-only view changes
 * for everyone else.
 */
export type CustomItem = {
  id: number
  rank: number
  points: number
  name: string
  gd_id: number | null
  creator: string | null
  gddl_tier: string | null
  verification_url: string | null
  percent_to_qualify: number
  records: { id: number }[]
  position?: number | null
  sheet_placement?: number | null
}

const props = defineProps<{
  items: CustomItem[]
  activeId?: number | null
  listPath: string
  /** Shows the reorder / remove affordances. */
  canEdit?: boolean
  /** `/api/custom-lists/:public_id` */
  apiBase?: string
  /** The list derives its order from ALL placements — manual moves are off. */
  followAllOrder?: boolean
  /** Grey out levels the ALL doesn't carry, rather than colouring by rank. */
  markOffAll?: boolean
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const search = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const { to } = useStandaloneList()

/**
 * Rank-badge colours, computed for the whole list at once — under the scaled
 * mode a row's colour depends on the rows around it, so this can't be a
 * per-row call without re-deriving the anchors 250 times.
 */
const rowColor = computed(() => {
  const colors = listRowColors(props.items, props.markOffAll !== false)
  const byId = new Map<number, string>()
  props.items.forEach((item, i) => byId.set(item.id, colors[i]!))
  return byId
})
function colorOf(item: CustomItem): string {
  return rowColor.value.get(item.id) ?? '#27272a'
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.items
  // "#12" jumps by rank, otherwise match name or creator.
  const byRank = q.match(/^#(\d+)$/)
  if (byRank) return props.items.filter((i) => i.rank === Number(byRank[1]))
  return props.items.filter(
    (i) => i.name.toLowerCase().includes(q) || (i.creator ?? '').toLowerCase().includes(q),
  )
})

watch(
  () => props.activeId,
  async (id) => {
    if (id == null) return
    await nextTick()
    scrollEl.value?.querySelector<HTMLElement>(`[data-item="${id}"]`)?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)

// ---------- edit mode ----------
const editing = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

// Dragging is disabled while a filter is applied: the visible order isn't the
// list order then, so a drop index would mean nothing. It's also off when the
// list takes its order from the ALL, where a manual move would be recomputed
// away on the next read.
const canReorder = computed(
  () => editing.value && !search.value.trim() && !props.followAllOrder,
)

const dragId = ref<number | null>(null)
/** Rank the dragged row would land on, for the drop indicator. */
const overRank = ref<number | null>(null)

function onDragStart(e: DragEvent, item: CustomItem) {
  if (!canReorder.value) return
  dragId.value = item.id
  e.dataTransfer?.setData('text/plain', String(item.id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(e: DragEvent, item: CustomItem) {
  if (!canReorder.value || dragId.value == null) return
  e.preventDefault()
  overRank.value = item.rank
}
function onDragEnd() {
  dragId.value = null
  overRank.value = null
}
async function onDrop(item: CustomItem) {
  const id = dragId.value
  onDragEnd()
  if (id == null || !canReorder.value) return
  const from = props.items.find((i) => i.id === id)
  if (!from || from.rank === item.rank) return
  await move(id, item.rank)
}

/** Inline rank box — commit on Enter or blur. */
const rankDraft = reactive<Record<number, string>>({})
function startRankEdit(item: CustomItem) {
  rankDraft[item.id] = String(item.rank)
}
async function commitRank(item: CustomItem) {
  const raw = rankDraft[item.id]
  delete rankDraft[item.id]
  const n = Number(raw)
  if (!Number.isFinite(n) || Math.round(n) === item.rank) return
  await move(item.id, Math.round(n))
}

async function move(itemId: number, toRank: number) {
  if (!props.apiBase || busy.value) return
  busy.value = true
  error.value = null
  try {
    await $fetch(`${props.apiBase}/move`, { method: 'POST', body: { item_id: itemId, to_rank: toRank } })
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not move that level.'
  } finally {
    busy.value = false
  }
}

async function remove(item: CustomItem) {
  if (!props.apiBase || busy.value) return
  if (!confirm(`Remove "${item.name}" from this list?`)) return
  busy.value = true
  error.value = null
  try {
    await $fetch(`${props.apiBase}/items/${item.id}`, { method: 'DELETE' })
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not remove that level.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <aside class="flex flex-col min-h-0 border-r border-zinc-800/80 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800/80 shrink-0">
      <div class="flex items-center gap-2 mb-2.5 px-1">
        <span class="text-[10px] uppercase tracking-widest text-accent font-semibold">Levels</span>
        <span class="text-[10px] text-zinc-600 tabular-nums ml-auto">{{ items.length }}</span>
      </div>

      <div class="flex items-stretch gap-1.5">
        <input
          v-model="search"
          type="search"
          placeholder="Search… name, creator, #rank"
          class="flex-1 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          v-if="canEdit"
          type="button"
          class="shrink-0 px-2 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1"
          :class="editing
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'"
          :aria-pressed="editing"
          title="Reorder levels"
          @click="editing = !editing"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </button>
      </div>

      <p v-if="editing" class="mt-2 text-[10px] leading-snug" :class="error ? 'text-red-400' : 'text-zinc-500'">
        <template v-if="error">{{ error }}</template>
        <template v-else-if="followAllOrder">
          This list is ordered by ALL placements — turn that off in settings to reorder by hand.
        </template>
        <template v-else-if="search.trim()">Clear the search to drag rows.</template>
        <template v-else>Drag a row to move it, or type a rank into the number.</template>
      </p>
    </div>

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <ul class="p-1.5 space-y-1" :class="{ 'opacity-60 pointer-events-none': busy }">
        <li
          v-for="lvl in filtered"
          :key="lvl.id"
          :data-item="lvl.id"
          :draggable="canReorder && !(lvl.id in rankDraft)"
          class="relative"
          @dragstart="onDragStart($event, lvl)"
          @dragover="onDragOver($event, lvl)"
          @drop.prevent="onDrop(lvl)"
          @dragend="onDragEnd"
        >
          <!-- Drop indicator -->
          <span
            v-if="overRank === lvl.rank && dragId !== lvl.id"
            class="absolute -top-0.5 inset-x-1 h-0.5 rounded bg-accent"
            aria-hidden="true"
          />

          <NuxtLink
            :to="to(`${listPath}/${lvl.rank}`)"
            class="relative overflow-hidden flex items-center gap-2.5 pl-1.5 pr-2 py-1.5 text-sm rounded-lg group transition-all"
            :class="[
              lvl.id === activeId
                ? 'ring-2 ring-inset ring-accent text-zinc-50 bg-zinc-900'
                : 'text-zinc-300 hover:text-zinc-50 ring-1 ring-inset ring-transparent hover:ring-zinc-700/60 hover:bg-zinc-900/50',
              dragId === lvl.id ? 'opacity-40' : '',
              canReorder ? 'cursor-grab active:cursor-grabbing' : '',
            ]"
          >
            <LevelThumbBg
              :gd-id="lvl.gd_id"
              :video-url="lvl.verification_url"
              res="small"
              :img-class="lvl.id === activeId ? 'opacity-60' : 'opacity-30 group-hover:opacity-55'"
              overlay-class="bg-gradient-to-r from-zinc-950/90 via-zinc-950/55 to-zinc-950/15"
            />

            <!-- Rank: a badge normally, an input while editing -->
            <input
              v-if="editing && lvl.id in rankDraft"
              v-model="rankDraft[lvl.id]"
              type="number"
              min="1"
              :max="items.length"
              class="relative w-14 shrink-0 text-center text-[11px] tabular-nums rounded-md border border-accent bg-zinc-900 py-1 focus:outline-none"
              @click.prevent.stop
              @keydown.enter.prevent="commitRank(lvl)"
              @keydown.esc.prevent="delete rankDraft[lvl.id]"
              @blur="commitRank(lvl)"
            />
            <span
              v-else
              class="relative text-[11px] tabular-nums px-1 py-1 w-14 shrink-0 text-center font-semibold rounded-md shadow-sm"
              :class="editing && !followAllOrder ? 'cursor-text ring-1 ring-inset ring-white/20' : ''"
              :style="{ backgroundColor: colorOf(lvl), color: textOn(colorOf(lvl)) }"
              :title="editing && !followAllOrder ? 'Click to type a rank' : undefined"
              @click.prevent.stop="editing && !followAllOrder && startRankEdit(lvl)"
            >{{ lvl.rank }}</span>

            <span class="relative flex-1 min-w-0">
              <span class="block truncate font-medium drop-shadow-sm">{{ lvl.name }}</span>
              <span v-if="lvl.creator" class="block truncate text-[10px] text-zinc-500">{{ lvl.creator }}</span>
            </span>

            <span class="relative shrink-0 text-right">
              <span class="block text-[11px] tabular-nums text-amber-300/90 font-medium">{{ lvl.points }}</span>
              <span v-if="lvl.records.length" class="block text-[9px] tabular-nums text-zinc-600">
                {{ lvl.records.length }} rec
              </span>
            </span>

            <button
              v-if="editing"
              type="button"
              class="relative shrink-0 text-zinc-600 hover:text-red-400 transition-colors leading-none px-1"
              title="Remove from list"
              @click.prevent.stop="remove(lvl)"
            >✕</button>
          </NuxtLink>
        </li>
        <li v-if="!filtered.length" class="px-3 py-8 text-xs text-zinc-500 text-center">No matches.</li>
      </ul>
    </div>
  </aside>
</template>

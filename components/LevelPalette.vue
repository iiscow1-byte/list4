<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * The searchable ALL-list palette, as the list builder shows it.
 *
 * Lifted out of `ListBuilder.vue` so the GDSR creator picks levels the same way
 * the list builder does — same rows, same thumbnails, same tier chips, same
 * paging — rather than through a separate modal that looked nothing like it.
 *
 * Paged, not capped: 54,000 levels behind a sixty-row window would otherwise be
 * reachable only by typing. Pages append as the sentinel scrolls into view, and
 * a new search throws the window away and starts again.
 */
export type PaletteLevel = {
  id: number
  position: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  difficulty: string | null
  creator?: string | null
  sheet_placement?: number | null
  verification_url?: string | null
}

const props = withDefaults(defineProps<{
  /** Level ids already used, dimmed so they read as spent without vanishing. */
  used?: Set<number>
  /** Height of the scrolling column. */
  maxHeight?: string
  title?: string
}>(), { maxHeight: '28rem', title: 'Add from the ALL list' })

const emit = defineEmits<{
  (e: 'pick', level: PaletteLevel): void
  (e: 'dragstart', level: PaletteLevel): void
  (e: 'dragend'): void
}>()

/**
 * Levels leave the palette by drag as well as by click.
 *
 * The payload is JSON on a custom type rather than plain text so a drop target
 * can tell a level apart from any other draggable on the page, and `text/plain`
 * carries the name as a courtesy for anything outside the app.
 */
function onDragStart(ev: DragEvent, l: PaletteLevel) {
  ev.dataTransfer?.setData('application/x-als-level', JSON.stringify(l))
  ev.dataTransfer?.setData('text/plain', l.name)
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'
  emit('dragstart', l)
}

const PAGE = 60
const search = ref('')
const items = ref<PaletteLevel[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const done = computed(() => items.value.length >= total.value)

const scroller = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)

let ctrl: AbortController | null = null
async function load(append = false) {
  if (loading.value && !append) ctrl?.abort()
  if (loading.value) return
  loading.value = true
  const next = append ? page.value + 1 : 1
  const mine = new AbortController()
  ctrl = mine
  try {
    const res = await $fetch<{ total: number; items: PaletteLevel[] }>('/api/levels', {
      query: { page: next, pageSize: PAGE, search: search.value || undefined },
      signal: mine.signal,
    })
    // A newer request has already replaced this one — its rows are the answer.
    if (ctrl !== mine) return
    items.value = append ? [...items.value, ...res.items] : res.items
    total.value = res.total
    page.value = next
  } catch (e: any) {
    if (e?.name !== 'AbortError' && e?.cause?.name !== 'AbortError') throw e
  } finally {
    if (ctrl === mine) loading.value = false
  }
}
load()

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    if (scroller.value) scroller.value.scrollTop = 0
    load()
  }, 220)
})

let io: IntersectionObserver | null = null
onMounted(() => {
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return
  io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !loading.value && !done.value) load(true)
  }, { root: scroller.value, rootMargin: '200px' })
  io.observe(sentinel.value)
})
onBeforeUnmount(() => { io?.disconnect(); if (debounce) clearTimeout(debounce) })
</script>

<template>
  <div class="card overflow-hidden flex flex-col">
    <div class="px-4 py-3 border-b border-zinc-800/80">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">{{ props.title }}</h2>
      <input v-model="search" type="search" placeholder="Search levels…" class="field field-md" />
    </div>

    <ul ref="scroller" class="overflow-y-auto p-1.5 space-y-1" :style="{ maxHeight: props.maxHeight }">
      <li v-for="l in items" :key="l.id">
        <button
          type="button"
          draggable="true"
          class="relative overflow-hidden w-full flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-lg text-left group ring-1 ring-inset ring-transparent hover:ring-zinc-700/60 transition-all cursor-grab active:cursor-grabbing"
          :class="props.used?.has(l.id) ? 'opacity-45' : ''"
          @click="emit('pick', l)"
          @dragstart="onDragStart($event, l)"
          @dragend="emit('dragend')"
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
          <span class="relative shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-500 group-hover:text-accent transition-colors">+</span>
        </button>
      </li>

      <li v-if="items.length === 0 && !loading" class="px-3 py-4 text-center text-xs text-zinc-600">No matches.</li>
      <li ref="sentinel" class="px-3 py-3 text-center text-[11px] text-zinc-600">
        <span v-if="loading">loading…</span>
        <span v-else-if="done && items.length">that's all of them</span>
        <span v-else-if="items.length">↓ scroll for more</span>
      </li>
    </ul>

    <div class="px-4 py-2 border-t border-zinc-800/80 text-[10px] text-zinc-600 tabular-nums">
      {{ items.length.toLocaleString() }} of {{ total.toLocaleString() }} levels
    </div>
  </div>
</template>

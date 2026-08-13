<script setup lang="ts">
/**
 * One group of admin tabs, as a dropdown.
 *
 * The panel had a "Pending" menu holding seven queues and then *ten loose
 * buttons* beside it, in a row that scrolled sideways. Finding the activity log
 * meant reading eleven controls and often dragging the row. This is that one
 * menu generalised so every group can be one, which turns eleven controls into
 * four.
 *
 * ## Why it teleports
 *
 * Two things in the tab bar make an absolutely-positioned panel unusable: the
 * row is `overflow-x-auto`, which clips vertically as well as horizontally, and
 * the nav has a `backdrop-blur`, which opens a stacking context a child's
 * `z-index` cannot escape — so the panel rendered *behind* the tab content. It
 * is fixed-positioned against measured coordinates instead, which is also why
 * it re-measures on scroll and resize.
 */
export type MenuTab = { id: string; label: string }

const props = defineProps<{
  /** Shown when no tab inside is active. */
  label: string
  tabs: MenuTab[]
  activeTab: string
  /** Unread/pending count per tab id. */
  badges?: Record<string, number>
}>()

const emit = defineEmits<{ (e: 'select', id: string): void }>()

const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0 })

const activeHere = computed(() => props.tabs.some((t) => t.id === props.activeTab))
const activeLabel = computed(() =>
  props.tabs.find((t) => t.id === props.activeTab)?.label ?? props.label,
)

/**
 * The group's badge is the sum of its members'.
 *
 * A collapsed group that hid a pending count would be worse than the loose
 * buttons it replaced — the whole reason to look at the bar is to see what is
 * waiting.
 */
const total = computed(() =>
  props.tabs.reduce((sum, t) => sum + (props.badges?.[t.id] ?? 0), 0),
)

function place() {
  const el = trigger.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const width = 208 // min-w-[13rem]
  pos.value = {
    top: r.bottom + 4,
    left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
  }
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  place()
  await nextTick()
  panel.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (trigger.value?.contains(t) || panel.value?.contains(t)) return
  open.value = false
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
function onReflow() {
  if (open.value) place()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onEsc)
  window.addEventListener('resize', onReflow)
  // `capture`, so the tab row's own horizontal scroll moves the panel with it.
  window.addEventListener('scroll', onReflow, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onEsc)
  window.removeEventListener('resize', onReflow)
  window.removeEventListener('scroll', onReflow, true)
})

function pick(id: string) {
  emit('select', id)
  open.value = false
}
</script>

<template>
  <div ref="trigger" class="relative shrink-0">
    <button
      type="button"
      class="relative flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
      :class="activeHere
        ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/25'
        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <!-- The active tab's own name when you are inside the group, so the bar
           still says where you are rather than only which drawer you are in. -->
      {{ activeHere ? activeLabel : label }}
      <svg
        viewBox="0 0 20 20" fill="currentColor"
        class="w-3.5 h-3.5 shrink-0 opacity-70 transition-transform"
        :class="{ 'rotate-180': open }"
        aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
      </svg>
      <span
        v-if="total > 0"
        class="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 leading-none"
      >{{ total > 99 ? '99+' : total }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        role="menu"
        class="fixed z-[60] min-w-[13rem] popover p-1"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
      >
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="menuitem"
          class="relative w-full text-left pl-3 pr-9 py-1.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          :class="activeTab === t.id
            ? 'text-accent bg-accent/10'
            : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900'"
          @click="pick(t.id)"
        >
          {{ t.label }}
          <span
            v-if="(badges?.[t.id] ?? 0) > 0"
            class="absolute top-1.5 right-2 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 leading-none"
          >{{ badges![t.id] }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

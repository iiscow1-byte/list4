<script setup lang="ts">
/**
 * A header dropdown. With `to`, the label is a link and the chevron opens the
 * menu; without it the whole button opens the menu.
 */
const props = defineProps<{
  label?: string
  to?: string
  active?: boolean
  align?: 'left' | 'right'
  ariaLabel?: string
  width?: string
  /** Small dot on the trigger, for something unread inside. */
  dot?: boolean
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const route = useRoute()

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
    root.value?.querySelector<HTMLElement>('button')?.focus()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onEsc)
})
watch(() => route.fullPath, () => { open.value = false })

function items(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}
function onPanelKeydown(e: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const rows = items()
  if (!rows.length) return
  e.preventDefault()
  const at = rows.indexOf(document.activeElement as HTMLElement)
  let next = 0
  if (e.key === 'End') next = rows.length - 1
  else if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % rows.length
  else if (e.key === 'ArrowUp') next = at <= 0 ? rows.length - 1 : at - 1
  rows[next]!.focus()
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  items()[0]?.focus({ preventScroll: true })
}

const base = 'relative text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
</script>

<template>
  <div ref="root" class="relative flex items-center">
    <template v-if="to">
      <NuxtLink
        :to="to"
        :class="[base, 'pl-2.5 pr-1 py-1.5 rounded-l-md', active ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100']"
      >{{ label }}</NuxtLink>
      <button
        type="button"
        :class="[base, 'pr-2 pl-0.5 py-1.5 rounded-r-md', active || open ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-100']"
        :aria-expanded="open"
        aria-haspopup="menu"
        :aria-label="ariaLabel ?? `More under ${label}`"
        @click="toggle"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" aria-hidden="true">
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
        </svg>
        <span v-if="dot" class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
      </button>
    </template>

    <button
      v-else
      type="button"
      :class="[base, 'flex items-center gap-1 px-2.5 py-1.5 rounded-md', active || open ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100']"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="ariaLabel ?? label"
      @click="toggle"
    >
      <slot name="trigger">{{ label }}</slot>
      <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" aria-hidden="true">
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
      </svg>
      <span v-if="dot" class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
    </button>

    <span v-if="active" class="absolute left-2.5 right-2.5 -bottom-[13px] h-0.5 rounded-full bg-accent" aria-hidden="true" />

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-75 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        ref="panel"
        role="menu"
        class="absolute top-full mt-2 popover p-1 z-40"
        :class="[align === 'right' ? 'right-0' : 'left-0', width ?? 'min-w-[12rem]']"
        @keydown="onPanelKeydown"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * Header dropdown. Every menu in the site header shares this so the
 * outside-click / Escape / close-on-navigate behaviour is written once.
 *
 * When `to` is set the label itself is a link and only the chevron opens the
 * menu — so "List" navigates while "List ▾" reveals the other lists.
 */
const props = defineProps<{
  label?: string
  to?: string
  active?: boolean
  align?: 'left' | 'right'
  /** Renders the trigger as a square icon button (used by the socials menu). */
  iconOnly?: boolean
  ariaLabel?: string
  width?: string
  /** Small dot on the trigger — used to flag unread updates. */
  dot?: boolean
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const route = useRoute()

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
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

/**
 * Up/Down walk the rows once the menu is open. Cheap to add here and it makes
 * every menu in the header keyboard-usable without each one knowing about it.
 */
function items(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}
function onPanelKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  const rows = items()
  if (!rows.length) return
  e.preventDefault()
  const at = rows.indexOf(document.activeElement as HTMLElement)
  let next = 0
  if (e.key === 'End') next = rows.length - 1
  else if (e.key === 'Home') next = 0
  else if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % rows.length
  else next = at <= 0 ? rows.length - 1 : at - 1
  rows[next]!.focus()
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  items()[0]?.focus({ preventScroll: true })
}
</script>

<template>
  <div ref="root" class="relative flex items-stretch">
    <!-- Split trigger: label navigates, chevron opens -->
    <template v-if="to">
      <NuxtLink
        :to="to"
        class="relative pl-3 pr-2 py-1.5 rounded-l-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        :class="{ 'text-zinc-100 bg-zinc-900': active }"
      >
        {{ label }}
        <span
          v-if="active"
          class="absolute inset-x-3 -bottom-px h-px bg-accent"
          aria-hidden="true"
        />
      </NuxtLink>
      <button
        type="button"
        class="relative px-1.5 py-1.5 rounded-r-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        :class="{ 'text-zinc-100 bg-zinc-900': open || active }"
        :aria-expanded="open"
        aria-haspopup="menu"
        :aria-label="ariaLabel ?? `${label} menu`"
        @click="toggle"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" aria-hidden="true">
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
        </svg>
        <span
          v-if="dot"
          class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent ring-2 ring-zinc-950"
          aria-hidden="true"
        />
      </button>
    </template>

    <!-- Single trigger -->
    <button
      v-else
      type="button"
      class="relative flex items-center gap-1 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      :class="[
        iconOnly ? 'p-1.5' : 'px-3 py-1.5',
        (open || active) ? 'text-zinc-100 bg-zinc-900' : '',
      ]"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="ariaLabel ?? label"
      @click="toggle"
    >
      <slot name="trigger">{{ label }}</slot>
      <svg v-if="!iconOnly" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" aria-hidden="true">
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
      </svg>
      <span
        v-if="dot"
        class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent ring-2 ring-zinc-950"
        aria-hidden="true"
      />
      <span
        v-if="active && !iconOnly"
        class="absolute inset-x-3 -bottom-px h-px bg-accent"
        aria-hidden="true"
      />
    </button>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        ref="panel"
        role="menu"
        class="absolute top-full mt-2 popover p-1.5 z-40"
        :class="[align === 'right' ? 'right-0' : 'left-0', width ?? 'min-w-[15rem]']"
        @keydown="onPanelKeydown"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>

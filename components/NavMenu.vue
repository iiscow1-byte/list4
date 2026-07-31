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
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const route = useRoute()

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
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
</script>

<template>
  <div ref="root" class="relative flex items-stretch">
    <!-- Split trigger: label navigates, chevron opens -->
    <template v-if="to">
      <NuxtLink
        :to="to"
        class="pl-3 pr-2 py-1.5 rounded-l-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
        :class="{ 'text-zinc-100 bg-zinc-900': active }"
      >{{ label }}</NuxtLink>
      <button
        type="button"
        class="px-1.5 py-1.5 rounded-r-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
        :class="{ 'text-zinc-100 bg-zinc-900': open || active }"
        :aria-expanded="open"
        aria-haspopup="menu"
        :aria-label="ariaLabel ?? `${label} menu`"
        @click="open = !open"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" aria-hidden="true">
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
        </svg>
      </button>
    </template>

    <!-- Single trigger -->
    <button
      v-else
      type="button"
      class="flex items-center gap-1 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
      :class="[
        iconOnly ? 'p-1.5' : 'px-3 py-1.5',
        (open || active) ? 'text-zinc-100 bg-zinc-900' : '',
      ]"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="ariaLabel ?? label"
      @click="open = !open"
    >
      <slot name="trigger">{{ label }}</slot>
      <svg v-if="!iconOnly" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': open }" aria-hidden="true">
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
      </svg>
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute top-full mt-1.5 rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/50 p-1 z-40"
      :class="[align === 'right' ? 'right-0' : 'left-0', width ?? 'min-w-[13rem]']"
    >
      <slot />
    </div>
  </div>
</template>

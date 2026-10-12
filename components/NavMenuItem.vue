<script setup lang="ts">
/** A row in a NavMenu: internal link, external link, or button. */
const props = defineProps<{
  to?: string
  href?: string
  /** Count on the right (unread, pending). */
  badge?: number | null
  /** Small dot after the label. */
  dot?: boolean
  danger?: boolean
}>()

const route = useRoute()
const isCurrent = computed(() => {
  if (!props.to) return false
  const target = props.to.split('?')[0]!
  if (route.path === target) return true
  const numeric = target.match(/^(.*)\/\d+$/)
  return !!numeric && new RegExp(`^${numeric[1]}/\\d+$`).test(route.path)
})

const rowClass = computed(() => [
  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left transition-colors focus-visible:outline-none focus-visible:bg-zinc-800',
  isCurrent.value
    ? 'bg-zinc-800 text-zinc-50'
    : props.danger
      ? 'text-red-300 hover:bg-red-950/40'
      : 'text-zinc-300 hover:text-zinc-50 hover:bg-zinc-800/70',
])
</script>

<template>
  <NuxtLink v-if="to" :to="to" role="menuitem" :class="rowClass">
    <span class="flex-1 min-w-0 truncate"><slot /></span>
    <span v-if="dot" class="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="new" />
    <span v-if="badge" class="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-accent text-[11px] font-semibold tabular-nums text-zinc-950 inline-flex items-center justify-center">{{ badge > 99 ? '99+' : badge }}</span>
  </NuxtLink>
  <a v-else-if="href" :href="href" target="_blank" rel="noopener noreferrer" role="menuitem" :class="rowClass">
    <span class="flex-1 min-w-0 truncate"><slot /></span>
    <svg viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 text-zinc-500 shrink-0" aria-hidden="true"><path d="M11 3a1 1 0 1 0 0 2h2.59l-6.3 6.29a1 1 0 1 0 1.42 1.42L15 6.41V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z" /><path d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z" /></svg>
  </a>
  <button v-else type="button" role="menuitem" :class="rowClass">
    <span class="flex-1 min-w-0 truncate"><slot /></span>
  </button>
</template>

<script setup lang="ts">
/**
 * A row inside a NavMenu: an internal link, an external link, or a button.
 *
 * The three cases are branched explicitly rather than driven through
 * `<component :is>`. Resolving NuxtLink dynamically silently degrades to an
 * unknown `<nuxtlink>` element when resolution fails, which renders as
 * unstyled inline text — the wrapper is cheap, the failure mode is not.
 */
const props = defineProps<{
  to?: string
  href?: string
  hint?: string
  accent?: boolean
  /** Count chip on the right (unread items, pending reviews, …). */
  badge?: number | null
}>()

const route = useRoute()

/**
 * Highlight the row for the page you're on, so an open menu tells you where
 * you are. Exact match plus child routes, so `/levels/1` lights up "Main list"
 * without `/levels/submit` lighting up too (it has its own row).
 */
const isCurrent = computed(() => {
  if (!props.to) return false
  const target = props.to.split('?')[0]!
  if (route.path === target) return true
  // `/levels/1` should match a `/levels/1` link but also `/levels/9000`; the
  // numeric tail is a position, not a distinct destination.
  const numeric = target.match(/^(.*)\/\d+$/)
  if (numeric && new RegExp(`^${numeric[1]}/\\d+$`).test(route.path)) return true
  return false
})

const rowClass = computed(() => [
  'group/item w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-left transition-colors',
  isCurrent.value
    ? 'bg-zinc-900 text-zinc-100'
    : props.accent
      ? 'text-accent hover:bg-accent/10'
      : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900',
])
</script>

<template>
  <NuxtLink v-if="to" :to="to" role="menuitem" :class="rowClass">
    <span
      class="w-7 h-7 shrink-0 rounded-lg border border-zinc-800/80 bg-zinc-900/60 flex items-center justify-center transition-colors"
      :class="accent ? 'text-accent border-accent/25 bg-accent/10' : 'text-zinc-500 group-hover/item:text-zinc-300'"
    >
      <slot name="icon">
        <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
      </slot>
    </span>
    <span class="flex-1 min-w-0">
      <span class="block truncate font-medium leading-tight"><slot /></span>
      <span v-if="hint" class="block truncate text-[10px] text-zinc-600 font-normal leading-tight mt-0.5">{{ hint }}</span>
    </span>
    <span
      v-if="badge"
      class="shrink-0 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-[10px] tabular-nums font-semibold text-white"
    >{{ badge > 99 ? '99+' : badge }}</span>
    <span
      v-else
      class="shrink-0 text-zinc-700 opacity-0 group-hover/item:opacity-100 transition-opacity text-xs"
      aria-hidden="true"
    >›</span>
  </NuxtLink>

  <a v-else-if="href" :href="href" target="_blank" rel="noopener noreferrer" role="menuitem" :class="rowClass">
    <span
      class="w-7 h-7 shrink-0 rounded-lg border border-zinc-800/80 bg-zinc-900/60 flex items-center justify-center text-zinc-500 group-hover/item:text-zinc-300 transition-colors"
    >
      <slot name="icon">
        <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
      </slot>
    </span>
    <span class="flex-1 min-w-0">
      <span class="block truncate font-medium leading-tight"><slot /></span>
      <span v-if="hint" class="block truncate text-[10px] text-zinc-600 font-normal leading-tight mt-0.5">{{ hint }}</span>
    </span>
    <span class="text-zinc-700 text-[10px] shrink-0" aria-hidden="true">↗</span>
  </a>

  <button v-else type="button" role="menuitem" :class="rowClass">
    <span
      class="w-7 h-7 shrink-0 rounded-lg border border-zinc-800/80 bg-zinc-900/60 flex items-center justify-center transition-colors"
      :class="accent ? 'text-accent border-accent/25 bg-accent/10' : 'text-zinc-500 group-hover/item:text-zinc-300'"
    >
      <slot name="icon">
        <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
      </slot>
    </span>
    <span class="flex-1 min-w-0">
      <span class="block truncate font-medium leading-tight"><slot /></span>
      <span v-if="hint" class="block truncate text-[10px] text-zinc-600 font-normal leading-tight mt-0.5">{{ hint }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
/**
 * The tab strip of a custom list.
 *
 * Its own component because the bar renders it twice — inline on a wide screen,
 * on its own scrolling row below the title on a narrow one. Two copies of the
 * same markup drifted the moment either was touched.
 */
export type ListTab = { to: string; label: string; active?: boolean; badge?: number }

defineProps<{
  tabs: ListTab[]
  /** `row` scrolls horizontally and fills the width; `inline` sits in the bar. */
  variant?: 'inline' | 'row'
}>()

const route = useRoute()
const { to } = useStandaloneList()

function isActive(t: ListTab) {
  return t.active ?? route.path === t.to
}
</script>

<template>
  <nav
    class="flex items-center gap-0.5 overflow-x-auto no-scrollbar"
    :class="variant === 'row' ? 'px-2 py-1.5' : ''"
    aria-label="List sections"
  >
    <NuxtLink
      v-for="t in tabs"
      :key="t.to"
      :to="to(t.to)"
      class="relative whitespace-nowrap px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
      :class="isActive(t)
        ? 'text-accent bg-accent/10 ring-1 ring-inset ring-accent/25'
        : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'"
      :aria-current="isActive(t) ? 'page' : undefined"
    >
      {{ t.label }}
      <span
        v-if="t.badge"
        class="ml-1 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-red-500 text-[9px] tabular-nums font-semibold text-white align-middle"
      >{{ t.badge }}</span>
    </NuxtLink>
  </nav>
</template>

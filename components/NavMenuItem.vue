<script setup lang="ts">
/**
 * A row inside a NavMenu: an internal link, an external link, or a button.
 *
 * The three cases are branched explicitly rather than driven through
 * `<component :is>`. Resolving NuxtLink dynamically silently degrades to an
 * unknown `<nuxtlink>` element when resolution fails, which renders as
 * unstyled inline text — the wrapper is cheap, the failure mode is not.
 */
defineProps<{
  to?: string
  href?: string
  hint?: string
  accent?: boolean
}>()

const base = 'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-left transition-colors'
</script>

<template>
  <NuxtLink v-if="to" :to="to" role="menuitem" :class="[base, accent ? 'text-accent hover:bg-accent/10' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900']">
    <slot name="icon" />
    <span class="flex-1 min-w-0">
      <span class="block truncate"><slot /></span>
      <span v-if="hint" class="block truncate text-[10px] text-zinc-600 font-normal">{{ hint }}</span>
    </span>
  </NuxtLink>

  <a v-else-if="href" :href="href" target="_blank" rel="noopener noreferrer" role="menuitem" :class="[base, accent ? 'text-accent hover:bg-accent/10' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900']">
    <slot name="icon" />
    <span class="flex-1 min-w-0">
      <span class="block truncate"><slot /></span>
      <span v-if="hint" class="block truncate text-[10px] text-zinc-600 font-normal">{{ hint }}</span>
    </span>
    <span class="text-zinc-600 text-[10px] shrink-0" aria-hidden="true">↗</span>
  </a>

  <button v-else type="button" role="menuitem" :class="[base, accent ? 'text-accent hover:bg-accent/10' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900']">
    <slot name="icon" />
    <span class="flex-1 min-w-0">
      <span class="block truncate"><slot /></span>
      <span v-if="hint" class="block truncate text-[10px] text-zinc-600 font-normal">{{ hint }}</span>
    </span>
  </button>
</template>

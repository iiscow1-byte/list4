<script setup lang="ts">
/** A row inside a NavMenu. Renders a link, or a button when `to` is omitted. */
defineProps<{
  to?: string
  href?: string
  hint?: string
  accent?: boolean
}>()
</script>

<template>
  <component
    :is="href ? 'a' : to ? resolveComponent('NuxtLink') : 'button'"
    :to="to"
    :href="href"
    :type="href || to ? undefined : 'button'"
    :target="href ? '_blank' : undefined"
    :rel="href ? 'noopener noreferrer' : undefined"
    role="menuitem"
    class="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-left transition-colors"
    :class="accent
      ? 'text-accent hover:bg-accent/10'
      : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900'"
  >
    <slot name="icon" />
    <span class="flex-1 min-w-0">
      <span class="block truncate"><slot /></span>
      <span v-if="hint" class="block truncate text-[10px] text-zinc-600">{{ hint }}</span>
    </span>
    <span v-if="href" class="text-zinc-600 text-[10px] shrink-0">↗</span>
  </component>
</template>

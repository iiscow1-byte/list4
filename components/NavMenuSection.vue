<script setup lang="ts">
/**
 * A labelled group inside a NavMenu. Splits a long menu into readable chunks
 * without turning every row into a wall of same-weight text.
 */
defineProps<{ label: string; first?: boolean }>()
</script>

<template>
  <p
    class="px-2 pb-1 text-[9px] uppercase tracking-[0.14em] text-zinc-600 font-semibold select-none"
    :class="first ? 'pt-1' : 'pt-2.5 mt-1 border-t border-zinc-800/70'"
  >{{ label }}</p>
</template>

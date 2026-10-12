<script setup lang="ts">
/** A divider inside a NavMenu, optionally with a small heading. */
defineProps<{ label?: string; first?: boolean }>()
</script>

<template>
  <div v-if="!first" class="my-1 border-t border-zinc-800" role="separator" />
  <p v-if="label" class="px-2.5 pt-1 pb-0.5 text-xs text-zinc-500 select-none">{{ label }}</p>
</template>

<script setup lang="ts">
/**
 * The logo (public/icon-180.png, cut from public/logo.png by
 * scripts/make-icons.mjs) and, optionally, the site's name beside it.
 */
withDefaults(defineProps<{
  /** Edge of the mark in px. */
  size?: number
  /** Print the name beside the mark. */
  wordmark?: boolean
  /** Hide the name below `sm` (the header on phones). */
  responsiveWordmark?: boolean
}>(), {
  size: 28,
  wordmark: false,
  responsiveWordmark: false,
})
</script>

<template>
  <span class="inline-flex items-center gap-2.5 min-w-0">
    <img
      src="/icon-180.png"
      :width="size"
      :height="size"
      :style="{ width: `${size}px`, height: `${size}px` }"
      class="shrink-0 rounded-md object-cover ring-1 ring-white/10 bg-zinc-900"
      alt="All Levels List"
      decoding="async"
      fetchpriority="high"
    />
    <span
      v-if="wordmark"
      class="min-w-0 truncate font-display text-[15px] font-semibold tracking-tight text-zinc-50"
      :class="responsiveWordmark ? 'hidden sm:inline' : 'inline'"
    >All Levels List</span>
  </span>
</template>

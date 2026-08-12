<script setup lang="ts">
/**
 * The All Levels List logo, and the lockup it sits in.
 *
 * The artwork is `public/logo.png` — a 512px square of level screenshots with
 * ALL set over them. This renders `public/icon-180.png`, the cut of it made by
 * `scripts/make-icons.mjs`: 180px covers a 56px mark on a 3× screen, and it is
 * the same file the iOS home-screen icon uses, so it is usually already in
 * cache. (An earlier version of this component drew a mark in SVG, which was a
 * stand-in for artwork that hadn't been handed over yet.)
 *
 * ## The wordmark
 *
 * The logo already says ALL, so the words beside it are "Levels List" and
 * nothing else — the two are read as one phrase. Printing "ALL Levels List"
 * next to a picture of the word ALL says it twice.
 *
 * ## Why it is clipped and ringed
 *
 * The source is a full-bleed square with hard edges and a busy, high-contrast
 * collage in it. Against a near-black header that reads as a photograph
 * somebody dropped on the page, so it takes the same rounded corner as every
 * other small tile on the site and a hairline to sit it on the background.
 */
withDefaults(defineProps<{
  /** Edge of the mark in px. The wordmark scales from the surrounding text. */
  size?: number
  /** Print "Levels List" beside the mark. */
  wordmark?: boolean
  /**
   * Hide the wordmark below `sm`. The header wants this — the mark alone is
   * the logo on a phone — and the About page does not.
   */
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
      class="shrink-0 rounded-[22%] object-cover ring-1 ring-zinc-700/70 bg-zinc-900"
      alt="All Levels List"
      decoding="async"
      fetchpriority="high"
    />

    <span
      v-if="wordmark"
      class="min-w-0"
      :class="responsiveWordmark ? 'hidden sm:inline-block' : 'inline-block'"
    >
      <span class="block text-[11px] uppercase tracking-[0.2em] font-medium text-zinc-400 leading-none truncate">
        Levels List
      </span>
    </span>
  </span>
</template>

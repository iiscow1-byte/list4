<script setup lang="ts">
/**
 * The All Levels List mark, and the lockup it sits in.
 *
 * The header used to print the letters `ALL` into an accent-filled rounded
 * square. That is a placeholder rather than a logo: it reads as three letters
 * at any size, it says nothing about what the site is, and at 16px in a browser
 * tab it is an unreadable smudge — which is exactly where a mark has to work
 * hardest.
 *
 * ## The mark
 *
 * An ascent to a peak, over two list rows of decreasing width. It is a *ranked
 * list read from the top*, which is the entire idea of this site, and it holds
 * up at 16px because it is three strokes with generous spacing and nothing that
 * depends on fine detail surviving.
 *
 * Drawn as strokes in `currentColor` rather than filled shapes, so one file
 * serves the header (accent), the About page (accent) and anywhere it needs to
 * be quiet (zinc). The tile behind it is a separate, optional layer for the
 * same reason.
 *
 * `public/favicon.svg` is this same geometry with the colours written out,
 * because a favicon is rendered by the browser chrome and cannot inherit
 * anything from the page. **The two must be kept in step** — if this drawing
 * changes, that file changes with it.
 */
withDefaults(defineProps<{
  /** Edge of the mark in px. The wordmark scales from the surrounding text. */
  size?: number
  /** Print "ALL Levels List" beside the mark. */
  wordmark?: boolean
  /**
   * Hide the wordmark below `sm`. The header wants this — the mark alone is
   * the logo on a phone — and the About page does not.
   */
  responsiveWordmark?: boolean
  /** The rounded tile behind the mark. Off gives a bare glyph. */
  tile?: boolean
}>(), {
  size: 28,
  wordmark: false,
  responsiveWordmark: false,
  tile: true,
})
</script>

<template>
  <span class="inline-flex items-center gap-2.5 min-w-0">
    <svg
      viewBox="0 0 32 32"
      fill="none"
      :width="size"
      :height="size"
      class="shrink-0"
      role="img"
      aria-label="All Levels List"
    >
      <!-- The tile is drawn in the surface colour with an accent hairline
           rather than filled with the accent itself. A solid accent block next
           to accent-coloured navigation is the loudest thing on the page, and
           the logo is not what anybody came to look at. -->
      <rect
        v-if="tile"
        x="0.75" y="0.75" width="30.5" height="30.5" rx="7.5"
        class="fill-zinc-900 stroke-accent/35"
        stroke-width="1.5"
      />
      <g
        class="stroke-accent"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <!-- The peak: the top of the list. -->
        <path d="M8.5 15.5 16 8l7.5 7.5" />
        <!-- Two rows below it, narrowing — a ranking, not a menu. -->
        <path d="M8.5 20.25h15" />
        <path d="M8.5 25h8.5" />
      </g>
    </svg>

    <span
      v-if="wordmark"
      class="flex items-baseline gap-1.5 min-w-0"
      :class="responsiveWordmark ? 'hidden sm:flex' : ''"
    >
      <!-- "ALL" carries the weight and "Levels List" is the expansion of it,
           so the two are one phrase read at two volumes rather than two labels
           competing. -->
      <span class="font-black tracking-tight text-zinc-50 leading-none">ALL</span>
      <span class="text-[11px] uppercase tracking-[0.2em] font-medium text-zinc-500 leading-none truncate">
        Levels List
      </span>
    </span>
  </span>
</template>

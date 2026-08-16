<script setup lang="ts">
/**
 * The small action icons the GDSR builder uses.
 *
 * The builder previously drew its actions with text glyphs — `↑`, `↓`, `✕`,
 * `▾`, `+`. Those inherit the font, sit on the text baseline rather than the
 * centre of their button, render at wildly different weights across platforms,
 * and are read aloud by a screen reader as "up arrow" rather than as what the
 * control does. One 16px grid, drawn on the same stroke, fixes all of that.
 *
 * `currentColor` throughout, so a button colours its icon by colouring itself.
 */
const props = withDefaults(defineProps<{
  name: 'up' | 'down' | 'trash' | 'plus' | 'grip' | 'eye-off' | 'palette' | 'chevron' | 'check' | 'link' | 'image'
  size?: number
}>(), { size: 16 })

const paths: Record<string, string> = {
  up: 'M8 3.5 4 8m4-4.5L12 8M8 3.5V13',
  down: 'M8 12.5 4 8m4 4.5L12 8M8 12.5V3',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13h6l.5-8.5M6.5 7v3.5M9.5 7v3.5',
  plus: 'M8 3.5v9M3.5 8h9',
  grip: 'M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01',
  'eye-off': 'M2 2l12 12M6.5 6.6A2 2 0 0 0 8 10a2 2 0 0 0 1.4-.6M4.2 4.6C2.8 5.6 1.8 7 1.5 8c.7 2 3.3 4.5 6.5 4.5 1 0 2-.25 2.9-.7M11.4 11 M7 3.6a6 6 0 0 1 1-.1c3.2 0 5.8 2.5 6.5 4.5-.3.8-1 1.9-2.1 2.9',
  palette: 'M8 1.5a6.5 6.5 0 0 0 0 13c.8 0 1.4-.6 1.4-1.4 0-.4-.15-.7-.4-.95-.25-.25-.4-.6-.4-.95 0-.8.6-1.4 1.4-1.4h1.6A3.9 3.9 0 0 0 15 5.9C15 3.5 11.9 1.5 8 1.5Z M4.75 7.5h.01M6.75 4.75h.01M9.75 4.5h.01M12 6.75h.01',
  chevron: 'M4 6l4 4 4-4',
  check: 'M3.5 8.5 6.5 11.5 12.5 5',
  link: 'M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.6-.6',
  image: 'M2.5 3.5h11v9h-11zM2.5 10l3-3 2.5 2.5L10.5 7l3 3M5.5 6.25h.01',
}
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path :d="paths[props.name]" />
  </svg>
</template>

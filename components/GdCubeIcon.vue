<script setup lang="ts">
/**
 * The icon for a Geometry Dash identity.
 *
 * A cube, because that's what a GD player is on screen. Drawn rather than
 * imported so it inherits `currentColor` like the Discord and YouTube marks it
 * sits beside, and so it costs nothing at load.
 */
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9.5" cy="10.5" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="10.5" r="1.25" fill="currentColor" stroke="none" />
    <path d="M9 15h6" stroke-linecap="round" />
  </svg>
</template>

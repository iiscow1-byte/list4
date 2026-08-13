<script setup lang="ts">
// A custom list opened through its standalone link is that list's own site:
// its bar becomes the page header, so the site header above it would be a
// second one. Every other page keeps the header it has always had.
const { standalone } = useStandaloneList()
</script>

<template>
  <!--
    `100dvh`, not `100vh`.

    A mobile browser reports `100vh` as the viewport with its address bar
    *hidden* — the tallest the window ever gets. This layout is a fixed-height
    `overflow-hidden` box, so on a phone that made the panes about 80px taller
    than the screen with no way to scroll to the difference: the bottom of the
    level list, and the last row of every panel, sat permanently under the
    address bar. `dvh` tracks the viewport as it actually is. `h-screen` stays
    as the fallback for browsers without it.
  -->
  <div class="h-screen supports-[height:100dvh]:h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
    <SiteHeader v-if="!standalone" />
    <main class="flex-1 min-h-0">
      <slot />
    </main>
  </div>
</template>

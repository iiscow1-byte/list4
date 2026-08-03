<script setup lang="ts">
// A custom list opened through its standalone link is that list's own site:
// its bar becomes the page header, so the site header above it would be a
// second one. Every other page keeps the header it has always had.
const { standalone } = useStandaloneList()
</script>

<template>
  <div class="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
    <SiteHeader v-if="!standalone" />
    <main class="flex-1 min-h-0">
      <slot />
    </main>
  </div>
</template>

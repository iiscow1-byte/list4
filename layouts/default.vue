<script setup lang="ts">
// See `layouts/level.vue` — a standalone list supplies its own chrome.
const { standalone } = useStandaloneList()
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
    <SiteHeader v-if="!standalone" />
    <main class="flex-1">
      <slot />
    </main>
    <SiteFooter v-if="!standalone" />
  </div>
</template>

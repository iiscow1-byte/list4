<script setup lang="ts">
const links = [
  { to: '/', label: 'List' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/about', label: 'About' },
]
</script>

<template>
  <header class="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-30">
    <div class="container-tight flex h-14 items-center justify-between">
      <NuxtLink to="/" class="flex items-center gap-2 group">
        <span class="font-mono text-accent text-lg font-semibold">ALL</span>
        <span class="font-mono text-sm uppercase tracking-[0.25em] text-zinc-400 group-hover:text-zinc-200 transition-colors">Levels List</span>
      </NuxtLink>
      <nav class="flex items-center gap-1">
        <NuxtLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="px-3 py-1.5 rounded text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
          active-class="text-zinc-100 bg-zinc-900"
        >
          {{ l.label }}
        </NuxtLink>
      </nav>
    </div>
  </header>
</template>

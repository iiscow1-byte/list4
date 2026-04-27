<script setup lang="ts">
const { data, pending } = await useFetch('/api/leaderboard', { query: { limit: 200 } })

function rankClass(rank: number) {
  if (rank === 1) return 'bg-amber-400 text-amber-950'
  if (rank === 2) return 'bg-zinc-300 text-zinc-900'
  if (rank === 3) return 'bg-orange-400/80 text-orange-950'
  if (rank <= 10) return 'bg-zinc-300/15 text-zinc-200'
  return 'bg-zinc-800 text-zinc-400'
}
</script>

<template>
  <div class="container-tight py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-semibold tracking-tight">Leaderboard</h1>
      <p class="text-zinc-400 mt-1 text-sm">Players ranked by total points across verified completions.</p>
    </div>

    <div v-if="pending" class="text-sm text-zinc-500">loading…</div>

    <ol v-else class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden">
      <li
        v-for="p in data?.items ?? []"
        :key="p.player_id"
        class="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900/60 transition-colors"
      >
        <span class="rank-badge" :class="rankClass(p.rank)">#{{ p.rank }}</span>
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate flex items-center gap-2">
            <span>{{ p.player }}</span>
            <span v-if="p.country" class="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">{{ p.country }}</span>
          </div>
          <div class="text-xs text-zinc-500">{{ p.completed }} completion{{ p.completed === 1 ? '' : 's' }}</div>
        </div>
        <span class="font-mono text-sm text-amber-300 shrink-0">{{ p.points.toLocaleString() }} pts</span>
      </li>
      <li v-if="!pending && (data?.items?.length ?? 0) === 0" class="px-4 py-12 text-center text-sm text-zinc-500">
        No completions yet.
      </li>
    </ol>
  </div>
</template>

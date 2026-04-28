<script setup lang="ts">
const { data, pending } = await useFetch('/api/leaderboard', { query: { limit: 200 } })

function rankClass(rank: number) {
  if (rank === 1) return 'bg-amber-400 text-amber-950'
  if (rank === 2) return 'bg-zinc-300 text-zinc-900'
  if (rank === 3) return 'bg-orange-400/80 text-orange-950'
  if (rank <= 10) return 'bg-zinc-300/15 text-zinc-200'
  return 'bg-zinc-800 text-zinc-400'
}
function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
</script>

<template>
  <div class="container-tight py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-semibold tracking-tight">Leaderboard</h1>
      <p class="text-zinc-400 mt-1 text-sm">Players ranked by total points across the All Levels List.</p>
    </div>

    <div v-if="pending" class="text-sm text-zinc-500">loading…</div>

    <ol v-else class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden">
      <li v-for="p in data?.items ?? []" :key="p.player">
        <NuxtLink
          :to="`/users/by-player/${encodeURIComponent(p.player)}`"
          class="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900/60 transition-colors group"
        >
          <span class="rank-badge" :class="rankClass(p.rank)">#{{ p.rank }}</span>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate flex items-center gap-2 group-hover:text-accent transition-colors">
              <span>{{ p.player }}</span>
              <span v-if="p.tier" class="text-[10px] uppercase tracking-widest text-zinc-500">tier {{ p.tier }}</span>
            </div>
            <div class="text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
              <span v-if="p.skill_points" class="tabular-nums">skill: {{ fmt(p.skill_points) }}</span>
              <span v-if="p.hardest">hardest: {{ p.hardest }}</span>
            </div>
          </div>
          <span class="tabular-nums text-sm text-amber-300 shrink-0">{{ fmt(p.points) }} pts</span>
        </NuxtLink>
      </li>
      <li v-if="!pending && (data?.items?.length ?? 0) === 0" class="px-4 py-12 text-center text-sm text-zinc-500">
        No players imported yet. Run <code class="text-amber-300 tabular-nums">npm run import</code>.
      </li>
    </ol>
  </div>
</template>

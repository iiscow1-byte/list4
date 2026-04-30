<script setup lang="ts">
const route = useRoute()
const playerName = computed(() => String(route.params.player))

const { data, error } = await useFetch<{
  player: { name: string; country: string | null; total_points: number; skill_points: number; hardest: string | null; tier: string | null }
  claimedBy: string | null
  derived: boolean
  completedLevels: any[]
  createdLevels: any[]
}>(() => `/api/users/by-player/${encodeURIComponent(playerName.value)}`, { watch: [playerName] })

// Redirect to the canonical /users/<username> page if this player has been claimed.
watchEffect(() => {
  if (data.value?.claimedBy) {
    navigateTo(`/users/${encodeURIComponent(data.value.claimedBy)}`, { replace: true })
  }
})

useHead(() => ({
  title: data.value ? `${data.value.player.name} — All Levels List` : 'Player — All Levels List',
}))

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
</script>

<template>
  <div class="container-tight py-8 max-w-3xl space-y-6">
    <div v-if="error" class="text-sm text-zinc-500">No such player on the leaderboard.</div>
    <template v-else-if="data && !data.claimedBy">
      <header class="flex items-start gap-4 flex-wrap">
        <div class="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center text-2xl text-zinc-600 font-bold">
          {{ data.player.name.charAt(0).toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <h1 class="text-3xl font-semibold tracking-tight">{{ data.player.name }}</h1>
          <p v-if="data.player.country" class="text-xs text-zinc-500 mt-1 uppercase">{{ data.player.country }}</p>
        </div>
      </header>

      <div class="rounded-md border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200">
        This user has not claimed their account yet.
        <span v-if="!data.derived" class="text-amber-200/70 block text-xs mt-1">
          Legacy stats below come straight from the original Google sheet. If this is you,
          <NuxtLink to="/signup" class="underline hover:text-amber-100">create an account</NuxtLink>
          and request to claim "{{ data.player.name }}".
        </span>
        <span v-else class="text-amber-200/70 block text-xs mt-1">
          Stats below are computed from this player's accepted records.
        </span>
      </div>

      <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Player stats</h2>
        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Total points</dt>
            <dd class="tabular-nums text-amber-300 text-base">{{ fmt(data.player.total_points) }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Skill points</dt>
            <dd class="tabular-nums text-zinc-100 text-base">{{ fmt(data.player.skill_points) }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Hardest</dt>
            <dd class="text-zinc-100 text-base truncate">{{ data.player.hardest ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Tier of hardest</dt>
            <dd class="text-zinc-100 text-base">{{ data.player.tier ?? '—' }}</dd>
          </div>
        </dl>
      </section>

      <ProfileLevelLists
        :completed="data.completedLevels"
        :created="data.createdLevels"
      />
    </template>
  </div>
</template>

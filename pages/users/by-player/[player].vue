<script setup lang="ts">
const route = useRoute()
const playerName = computed(() => String(route.params.player))

const { data, error } = await useFetch<{
  player: { name: string; country: string | null; total_points: number; skill_points: number; hardest: string | null; tier: string | null }
  claimedBy: string | null
  derived: boolean
  completedLevels: any[]
  createdLevels: any[]
  external?: { source: string; label: string; to: string; rank: number | null; points: number | null }[]
  follow: { target: string; followed: boolean; followerCount: number; isSelf: boolean; canFollow: boolean }
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
  <div class="container-tight py-8 max-w-5xl">
    <div v-if="error" class="text-sm text-zinc-500">No such player on the leaderboard.</div>
    <div v-else-if="data && !data.claimedBy" class="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
      <aside class="lg:sticky lg:top-20 lg:self-start">
        <RecordCharts :completed="data.completedLevels" />
      </aside>
      <main class="space-y-6 min-w-0">
      <header class="flex items-start gap-4 flex-wrap">
        <div class="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center text-2xl text-zinc-600 font-bold">
          {{ data.player.name.charAt(0).toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <h1 class="text-3xl font-semibold tracking-tight">{{ data.player.name }}</h1>
          <p v-if="data.player.country" class="text-xs text-zinc-500 mt-1 uppercase">{{ data.player.country }}</p>
          <div class="mt-2">
            <FollowButton
              :target="data.follow.target"
              :initial-followed="data.follow.followed"
              :can-follow="data.follow.canFollow"
              :is-self="data.follow.isSelf"
              :follower-count="data.follow.followerCount"
            />
          </div>
        </div>
      </header>

      <!-- Where else this player ranks.
           The leaderboard sends every row here now, including players the ALL
           itself has never heard of, so the page has to answer "who is this"
           for them — and the answer is the lists that do know them. -->
      <section v-if="data.external?.length" class="card p-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Also ranked on</h2>
        <ul class="grid gap-px bg-zinc-800 rounded-lg overflow-hidden border border-zinc-800 sm:grid-cols-3">
          <li v-for="e in data.external" :key="e.source" class="bg-zinc-950">
            <NuxtLink :to="e.to" class="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/70 transition-colors group">
              <span class="text-sm text-zinc-300 group-hover:text-accent transition-colors">{{ e.label }}</span>
              <span class="ml-auto text-right tabular-nums">
                <span v-if="e.rank != null" class="block text-sm text-zinc-200">#{{ e.rank.toLocaleString() }}</span>
                <span v-if="e.points != null" class="block text-[10px] text-zinc-600">{{ fmt(e.points) }} pts</span>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>

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

      <section class="card p-4">
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
      </main>
    </div>
  </div>
</template>

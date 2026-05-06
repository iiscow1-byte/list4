<script setup lang="ts">
const route = useRoute()
const gdlId = computed(() => String(route.params.id))

type LevelRow = { position: number; name: string; points: number | null; gddl_tier: string | null }
type CompletedLevel = LevelRow & { percent: number }
type OffListLevel = {
  gdl_position: number | null
  name: string
  points: number | null
  list_type: string | null
  percent: number
  is_verification: number | null
  video_url: string | null
}

const { data, error } = await useFetch<{
  player: { name: string; country: string | null; total_points: number; pack_points: number; extremes: number; hardest: string | null; rank: number | null; banned: boolean; badge: string | null; skill_points: number; tier: string | null }
  description: string | null
  discord_id: string | null
  claimedBy: string | null
  completedLevels: CompletedLevel[]
  offListCompleted: OffListLevel[]
  createdLevels: LevelRow[]
  publishedCount: number
}>(() => `/api/gdl-players/${gdlId.value}`, { watch: [gdlId] })

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

function badgeLabel(b: string | null): string | null {
  if (!b) return null
  if (b === 'pc') return 'PC'
  if (b === 'mobile') return 'Mobile'
  if (b === 'former_cheater') return 'Former cheater'
  if (b === 'contributor') return 'Contributor'
  return b
}
</script>

<template>
  <div class="container-tight py-8 max-w-5xl">
    <div v-if="error" class="text-sm text-zinc-500">GDL player not found.</div>
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
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-3xl font-semibold tracking-tight">{{ data.player.name }}</h1>
              <span class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">GDL</span>
              <span
                v-if="badgeLabel(data.player.badge)"
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400"
              >{{ badgeLabel(data.player.badge) }}</span>
              <span
                v-if="data.player.banned"
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-red-900/40 text-red-300"
              >Banned</span>
            </div>
            <p v-if="data.player.country" class="text-xs text-zinc-500 mt-1">{{ data.player.country }}</p>
          </div>
        </header>

        <div class="rounded-md border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200">
          This GDL player has not claimed their account yet.
          <span class="text-amber-200/70 block text-xs mt-1">
            Stats below are mirrored from the Global Demonlist. If this is you,
            <NuxtLink to="/signup" class="underline hover:text-amber-100">create an account</NuxtLink>
            and request to claim "{{ data.player.name }}".
          </span>
        </div>

        <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Player stats</h2>
          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">GDL points</dt>
              <dd class="tabular-nums text-amber-300 text-base">{{ fmt(data.player.total_points) }}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Hardest</dt>
              <dd class="text-zinc-100 text-base truncate">{{ data.player.hardest ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">GDL rank</dt>
              <dd class="tabular-nums text-zinc-100 text-base">{{ data.player.rank != null ? `#${data.player.rank}` : '—' }}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Country</dt>
              <dd class="text-zinc-100 text-base">{{ data.player.country ?? '—' }}</dd>
            </div>
          </dl>
        </section>

        <ProfileLevelLists :completed="data.completedLevels" />

        <section
          v-if="data.offListCompleted.length"
          class="rounded-md border border-zinc-800 bg-zinc-950/60"
        >
          <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium px-4 pt-3 pb-2">
            Other GDL completions
            <span class="text-[11px] text-zinc-600 normal-case tracking-normal ml-1">
              demons not on the ALL list
            </span>
          </h2>
          <ul class="divide-y divide-zinc-900 text-sm">
            <li
              v-for="(l, i) in data.offListCompleted"
              :key="`off-${i}`"
              class="px-4 py-1.5 flex items-center gap-3"
            >
              <span class="text-[11px] tabular-nums px-2 py-0.5 w-14 shrink-0 text-center font-medium rounded bg-zinc-800 text-zinc-400">
                G#{{ l.gdl_position }}
              </span>
              <span class="truncate flex-1 text-zinc-300">{{ l.name }}</span>
              <span v-if="l.is_verification" class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">Verifier</span>
              <a v-if="l.video_url" :href="l.video_url" target="_blank" rel="noopener" class="text-accent hover:underline text-xs">video ↗</a>
            </li>
          </ul>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const uuid = computed(() => String(route.params.uuid))

type LevelRow = { position: number; name: string; points: number | null; gddl_tier: string | null }
type CompletedLevel = LevelRow & { percent: number }
type AredlOnlyLevel = { aredl_position: number; name: string; points: number | null; gddl_tier: string | null }

const { data, error } = await useFetch<{
  player: { name: string; country: string | null; total_points: number; pack_points: number; extremes: number; hardest: string | null; rank: number | null; skill_points: number; tier: string | null }
  description: string | null
  discord_id: string | null
  claimedBy: string | null
  completedLevels: CompletedLevel[]
  aredlOnlyCompleted: Array<AredlOnlyLevel & { percent?: number }>
  createdLevels: LevelRow[]
  aredlOnlyCreated: AredlOnlyLevel[]
  publishedCount: number
}>(() => `/api/aredl-players/${uuid.value}`, { watch: [uuid] })

// If this Aredl player has been claimed by an account on our site, kick the
// visitor over to the canonical site profile — same redirect pattern the
// legacy by-player page uses.
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
    <div v-if="error" class="text-sm text-zinc-500">Aredl player not found.</div>
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
              <span class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">AREDL</span>
            </div>
            <p v-if="data.player.country" class="text-xs text-zinc-500 mt-1 uppercase">{{ data.player.country }}</p>
            <p v-if="data.description" class="mt-3 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed max-w-prose">
              {{ data.description }}
            </p>
          </div>
        </header>

        <div class="rounded-md border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200">
          This AREDL player has not claimed their account yet.
          <span class="text-amber-200/70 block text-xs mt-1">
            Stats below are mirrored from the AREDL list. If this is you,
            <NuxtLink to="/signup" class="underline hover:text-amber-100">create an account</NuxtLink>
            and request to claim "{{ data.player.name }}".
          </span>
        </div>

        <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Player stats</h2>
          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">AREDL points</dt>
              <dd class="tabular-nums text-amber-300 text-base">{{ fmt(data.player.total_points) }}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Extremes</dt>
              <dd class="tabular-nums text-zinc-100 text-base">{{ fmt(data.player.extremes) }}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Hardest</dt>
              <dd class="text-zinc-100 text-base truncate">{{ data.player.hardest ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-[10px] uppercase tracking-wider text-zinc-500">AREDL rank</dt>
              <dd class="tabular-nums text-zinc-100 text-base">{{ data.player.rank != null ? `#${data.player.rank}` : '—' }}</dd>
            </div>
          </dl>
        </section>

        <ProfileLevelLists
          :completed="data.completedLevels"
          :created="data.createdLevels"
        />

        <section
          v-if="data.aredlOnlyCompleted.length || data.aredlOnlyCreated.length"
          class="rounded-md border border-zinc-800 bg-zinc-950/60"
        >
          <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium px-4 pt-3 pb-2">
            AREDL-only levels
            <span class="text-[11px] text-zinc-600 normal-case tracking-normal ml-1">
              not on the ALL list
            </span>
          </h2>
          <div v-if="data.aredlOnlyCompleted.length" class="px-4 pt-1 pb-2">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Completed</div>
            <ul class="divide-y divide-zinc-900">
              <li v-for="(l, i) in data.aredlOnlyCompleted" :key="`aoc-${i}`" class="py-1.5 flex items-center gap-3 text-sm">
                <span class="text-[11px] tabular-nums px-2 py-0.5 w-14 shrink-0 text-center font-medium rounded bg-zinc-800 text-zinc-400">
                  A#{{ l.aredl_position }}
                </span>
                <span class="truncate flex-1 text-zinc-300">{{ l.name }}</span>
                <span class="tabular-nums text-xs text-amber-300">{{ fmt(l.points) }}</span>
              </li>
            </ul>
          </div>
          <div v-if="data.aredlOnlyCreated.length" class="px-4 pt-1 pb-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Created</div>
            <ul class="divide-y divide-zinc-900">
              <li v-for="(l, i) in data.aredlOnlyCreated" :key="`aoc2-${i}`" class="py-1.5 flex items-center gap-3 text-sm">
                <span class="text-[11px] tabular-nums px-2 py-0.5 w-14 shrink-0 text-center font-medium rounded bg-zinc-800 text-zinc-400">
                  A#{{ l.aredl_position }}
                </span>
                <span class="truncate flex-1 text-zinc-300">{{ l.name }}</span>
                <span class="tabular-nums text-xs text-amber-300">{{ fmt(l.points) }}</span>
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

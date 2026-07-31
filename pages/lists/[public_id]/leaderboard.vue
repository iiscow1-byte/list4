<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list } = useCustomList(publicId)

type LbRow = {
  rank: number; player_name: string; points: number; completions: number
  progresses: number; hardest_name: string | null; hardest_rank: number | null
  account_username: string | null
}
const { data } = await useFetch<{ leaderboard: LbRow[] }>(
  () => `/api/custom-lists/${publicId.value}/leaderboard`,
)
const rows = computed(() => data.value?.leaderboard ?? [])
const topPoints = computed(() => rows.value[0]?.points ?? 0)

/** Medal tint for the top three, plain otherwise. */
function rankClass(rank: number): string {
  if (rank === 1) return 'text-amber-300'
  if (rank === 2) return 'text-zinc-300'
  if (rank === 3) return 'text-orange-300'
  return 'text-zinc-600'
}

useHead(() => ({ title: list.value ? `Leaderboard — ${list.value.title}` : 'Leaderboard' }))
</script>

<template>
  <CustomListShell :public-id="publicId" width="wide">
    <template #default="{ list: l }">
      <div class="flex items-baseline justify-between gap-3 mb-3">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Leaderboard</h2>
        <span class="text-[10px] text-zinc-600 tabular-nums">
          #1 worth {{ l.max_points }} pts · last worth {{ l.min_points }}
        </span>
      </div>

      <div v-if="!rows.length" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">No approved records yet.</p>
        <p class="text-xs text-zinc-600 mt-1">The leaderboard fills in as records come in.</p>
        <NuxtLink
          v-if="l.accepts_records"
          :to="`/lists/${publicId}/submit`"
          class="inline-block mt-4 rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-4 py-2 hover:bg-accent/90 transition-colors"
        >Be the first to submit →</NuxtLink>
      </div>

      <ul v-else class="card divide-y divide-zinc-900/60 overflow-hidden">
        <li
          v-for="p in rows"
          :key="p.player_name"
          class="relative px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-zinc-900/40 transition-colors"
        >
          <!-- Points bar, scaled against the leader -->
          <span
            class="absolute inset-y-0 left-0 bg-accent/[0.07] pointer-events-none"
            :style="{ width: topPoints ? `${(p.points / topPoints) * 100}%` : '0%' }"
            aria-hidden="true"
          />
          <span class="relative shrink-0 w-8 text-center tabular-nums font-bold" :class="rankClass(p.rank)">
            {{ p.rank }}
          </span>
          <NuxtLink
            v-if="p.account_username"
            :to="`/users/${encodeURIComponent(p.account_username)}`"
            class="relative font-medium text-zinc-100 hover:text-accent transition-colors truncate"
          >{{ p.player_name }}</NuxtLink>
          <span v-else class="relative font-medium text-zinc-100 truncate">{{ p.player_name }}</span>
          <span v-if="p.hardest_name" class="relative hidden sm:block text-[11px] text-zinc-600 truncate flex-1">
            hardest: {{ p.hardest_name }}
          </span>
          <span class="relative ml-auto shrink-0 text-[11px] text-zinc-500 tabular-nums">
            {{ p.completions }} done<template v-if="p.progresses"> · {{ p.progresses }} prog</template>
          </span>
          <span class="relative shrink-0 tabular-nums text-amber-300 font-semibold w-20 text-right">{{ p.points }}</span>
        </li>
      </ul>
    </template>
  </CustomListShell>
</template>

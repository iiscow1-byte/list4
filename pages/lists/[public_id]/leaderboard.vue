<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, canEdit, pendingCount, liked, toggleLike } = useCustomList(publicId)

type LbRow = {
  rank: number; player_name: string; points: number; completions: number
  progresses: number; hardest_name: string | null; hardest_rank: number | null
  account_username: string | null
}
const { data } = await useFetch<{ leaderboard: LbRow[] }>(
  () => `/api/custom-lists/${publicId.value}/leaderboard`,
)
const rows = computed(() => data.value?.leaderboard ?? [])

useHead(() => ({ title: list.value ? `Leaderboard — ${list.value.title}` : 'Leaderboard' }))
</script>

<template>
  <div v-if="list" class="h-full flex flex-col min-h-0">
    <CustomListBar :list="list" :can-edit="canEdit" :pending-count="pendingCount" :liked="liked" @like="toggleLike" />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div class="flex items-baseline justify-between gap-3 mb-3">
          <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Leaderboard</h2>
          <span class="text-[10px] text-zinc-600">
            #1 worth {{ list.max_points }} pts · last worth {{ list.min_points }}
          </span>
        </div>

        <p v-if="!rows.length" class="text-sm text-zinc-500 py-16 text-center">
          No approved records yet — the leaderboard fills in as records come in.
        </p>
        <ul v-else class="card divide-y divide-zinc-900/60 overflow-hidden">
          <li
            v-for="p in rows"
            :key="p.player_name"
            class="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-zinc-900/40 transition-colors"
          >
            <span
              class="shrink-0 w-8 text-center tabular-nums font-bold"
              :class="p.rank === 1 ? 'text-amber-300' : p.rank <= 3 ? 'text-zinc-300' : 'text-zinc-600'"
            >{{ p.rank }}</span>
            <NuxtLink
              v-if="p.account_username"
              :to="`/users/${encodeURIComponent(p.account_username)}`"
              class="font-medium text-zinc-100 hover:text-accent transition-colors truncate"
            >{{ p.player_name }}</NuxtLink>
            <span v-else class="font-medium text-zinc-100 truncate">{{ p.player_name }}</span>
            <span v-if="p.hardest_name" class="hidden sm:block text-[11px] text-zinc-600 truncate flex-1">
              hardest: {{ p.hardest_name }}
            </span>
            <span class="ml-auto shrink-0 text-[11px] text-zinc-500 tabular-nums">
              {{ p.completions }} done<template v-if="p.progresses"> · {{ p.progresses }} prog</template>
            </span>
            <span class="shrink-0 tabular-nums text-amber-300 font-semibold w-20 text-right">{{ p.points }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

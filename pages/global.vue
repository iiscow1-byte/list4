<script setup lang="ts">
useHead({ title: 'Global Leaderboard — All Levels List' })

type Row = {
  rank: number
  source: 'aredl'
  uuid: string
  player: string
  country: number | null
  points: number
  pack_points: number
  extremes: number
  hardest: string | null
  claimed_account: { username: string; role: string | null; badge: string | null } | null
}

const search = ref('')
const debounced = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debounced.value = v.trim() }, 200)
})

const source = ref<'all' | 'aredl'>('all')

const query = computed(() => ({
  limit: 200,
  q: debounced.value || undefined,
  source: source.value === 'aredl' ? 'aredl' : 'all',
}))

const { data, pending } = await useFetch<{ total: number; items: Row[] }>(
  '/api/leaderboard/global',
  { query, watch: [query] },
)

function rankClass(rank: number) {
  if (rank === 1) return 'bg-amber-400 text-amber-950'
  if (rank === 2) return 'bg-zinc-300 text-zinc-900'
  if (rank === 3) return 'bg-orange-400/80 text-orange-950'
  if (rank <= 10) return 'bg-zinc-300/15 text-zinc-200'
  return 'bg-zinc-800 text-zinc-400'
}
function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
</script>

<template>
  <div class="container-tight py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-semibold tracking-tight">Global Leaderboard</h1>
      <p class="text-zinc-400 mt-1 text-sm">
        Players from external lists. Currently AREDL — more list integrations to come.
        These accounts are unclaimed; log in and claim one to take ownership.
      </p>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden">
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors"
          :class="source === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="source = 'all'"
        >All sources</button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors border-l border-zinc-800"
          :class="source === 'aredl' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="source = 'aredl'"
        >AREDL</button>
      </div>
      <div class="relative flex-1 min-w-[200px] max-w-md">
        <input
          v-model="search"
          type="search"
          placeholder="Search players…"
          class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        />
      </div>
    </div>

    <div v-if="pending" class="text-sm text-zinc-500">loading…</div>
    <ol v-else class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden">
      <li v-for="p in data?.items ?? []" :key="`${p.source}-${p.uuid}`">
        <NuxtLink
          :to="`/aredl-players/${p.uuid}`"
          class="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900/60 transition-colors group"
        >
          <span class="rank-badge" :class="rankClass(p.rank)">#{{ p.rank }}</span>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate flex items-center gap-2 group-hover:text-accent transition-colors">
              <span>{{ p.player }}</span>
              <span class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                {{ p.source }}
              </span>
              <span
                v-if="p.claimed_account"
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 shrink-0"
                :title="`Claimed by @${p.claimed_account.username}`"
              >Claimed</span>
            </div>
            <div class="text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
              <span v-if="p.extremes" class="tabular-nums">{{ p.extremes }} extremes</span>
              <span v-if="p.hardest">Hardest: {{ p.hardest }}</span>
            </div>
          </div>
          <span
            class="tabular-nums text-sm shrink-0"
            :class="p.points > 0 ? 'text-amber-300' : 'text-zinc-600'"
          >{{ fmt(p.points) }} pts</span>
        </NuxtLink>
      </li>
      <li v-if="(data?.items?.length ?? 0) === 0" class="px-4 py-12 text-center text-sm text-zinc-500">
        <template v-if="debounced">
          No players match "{{ debounced }}".
        </template>
        <template v-else>
          No players imported yet.
        </template>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list } = useCustomList(publicId)

type LbRow = {
  rank: number; player_name: string; points: number; completions: number
  progresses: number; hardest_name: string | null; hardest_rank: number | null
  hardest_gd_id: number | null
  account_username: string | null; has_avatar: boolean
}
const { data, pending } = await useFetch<{ leaderboard: LbRow[] }>(
  () => `/api/custom-lists/${publicId.value}/leaderboard`,
)
const all = computed(() => data.value?.leaderboard ?? [])

const search = ref('')
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return all.value
  return all.value.filter((p) => p.player_name.toLowerCase().includes(q))
})

/**
 * The podium is the unfiltered top three — a search result's "#1" is the best
 * match, not the best player, so it drops away as soon as you type.
 *
 * It needs all three to render (`podium.length === 3` below), and this is where
 * that used to go wrong: with one or two players it was non-empty but unshown,
 * so the podium didn't render *and* `listRows` skipped past everyone. The whole
 * leaderboard came out as "No players match “”" — the reported bug. A podium of
 * fewer than three players isn't a podium; those players belong in the table.
 */
const podium = computed(() =>
  search.value.trim() || all.value.length < 3 ? [] : all.value.slice(0, 3),
)
const listRows = computed(() => (podium.value.length ? rows.value.slice(3) : rows.value))

/**
 * Why the table is empty — which is not always "the search found nothing".
 * With exactly three players the podium above is showing all of them, and
 * saying nobody matched an empty search is both wrong and confusing.
 */
const emptyReason = computed<'search' | 'all-on-podium' | null>(() => {
  if (listRows.value.length) return null
  return search.value.trim() ? 'search' : 'all-on-podium'
})
const topPoints = computed(() => all.value[0]?.points ?? 0)
const barMax = computed(() => topPoints.value)
const barOf = (p: LbRow) => p.points

/** Totals across everyone, for the strip above the table. */
const totals = computed(() => ({
  players: all.value.length,
  completions: all.value.reduce((n, p) => n + p.completions, 0),
  progresses: all.value.reduce((n, p) => n + p.progresses, 0),
}))

function rankBadge(rank: number): string {
  if (rank === 1) return 'bg-amber-400 text-amber-950'
  if (rank === 2) return 'bg-zinc-300 text-zinc-900'
  if (rank === 3) return 'bg-orange-400/80 text-orange-950'
  if (rank <= 10) return 'bg-zinc-300/15 text-zinc-200'
  return 'bg-zinc-800 text-zinc-400'
}
function podiumRing(rank: number): string {
  if (rank === 1) return 'ring-amber-400/80'
  if (rank === 2) return 'ring-zinc-300/70'
  return 'ring-orange-400/70'
}
function avatar(p: LbRow): string | null {
  return p.has_avatar && p.account_username
    ? `/api/users/${encodeURIComponent(p.account_username)}/avatar`
    : null
}
function profile(p: LbRow): string | null {
  return p.account_username ? `/users/${encodeURIComponent(p.account_username)}` : null
}
function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

useHead(() => ({ title: list.value ? `Leaderboard — ${list.value.title}` : 'Leaderboard' }))
</script>

<template>
  <CustomListShell :public-id="publicId" width="wide">
    <template #default="{ list: l }">
      <header class="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Leaderboard</h2>
          <p class="text-sm text-zinc-400 mt-0.5">
            Ranked by the points each approved record is worth.
          </p>
        </div>
        <div class="text-[10px] text-zinc-600 tabular-nums text-right">
          <div>#1 worth {{ l.max_points }} pts · last worth {{ l.min_points }}</div>
          <div v-if="l.scored_count">only the top {{ l.scored_count }} score</div>
        </div>
      </header>

      <div v-if="!all.length" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">{{ pending ? 'Loading…' : 'No approved records yet.' }}</p>
        <p v-if="!pending" class="text-xs text-zinc-600 mt-1">The leaderboard fills in as records come in.</p>
        <NuxtLink
          v-if="!pending && l.accepts_records"
          :to="`/lists/${publicId}/submit`"
          class="btn btn-sm btn-primary mt-4"
        >Be the first to submit →</NuxtLink>
      </div>

      <template v-else>
        <!-- Totals strip -->
        <dl class="grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70 mb-4">
          <div v-for="s in [
            { l: 'Players', v: totals.players },
            { l: 'Completions', v: totals.completions },
            { l: 'Progresses', v: totals.progresses },
          ]" :key="s.l" class="bg-zinc-950 px-3 py-2">
            <dt class="text-[9px] uppercase tracking-widest text-zinc-600">{{ s.l }}</dt>
            <dd class="text-base font-semibold tabular-nums text-zinc-200">{{ s.v.toLocaleString() }}</dd>
          </div>
        </dl>

        <!-- Podium -->
        <ol v-if="podium.length === 3" class="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
          <li
            v-for="p in [podium[1], podium[0], podium[2]]"
            :key="p!.player_name"
            :class="p!.rank === 1 ? 'sm:-mt-3' : ''"
          >
            <!-- Linked when the player has a site account, plain otherwise.
                 Branched explicitly: a dynamic `<component :is>` that fails to
                 resolve NuxtLink degrades to unstyled inline text. -->
            <NuxtLink
              v-if="profile(p!)"
              :to="profile(p!)!"
              class="relative h-full overflow-hidden flex flex-col items-center text-center gap-1.5 rounded-xl border bg-zinc-950 px-2 py-4 transition-colors group"
              :class="p!.rank === 1 ? 'border-amber-500/40 hover:border-amber-400/70' : 'border-zinc-800 hover:border-zinc-600'"
            >
              <CustomListPodiumCard :row="p!" :ring="podiumRing(p!.rank)" :badge="rankBadge(p!.rank)" />
            </NuxtLink>
            <div
              v-else
              class="relative h-full overflow-hidden flex flex-col items-center text-center gap-1.5 rounded-xl border bg-zinc-950 px-2 py-4 group"
              :class="p!.rank === 1 ? 'border-amber-500/40' : 'border-zinc-800'"
            >
              <CustomListPodiumCard :row="p!" :ring="podiumRing(p!.rank)" :badge="rankBadge(p!.rank)" />
            </div>
          </li>
        </ol>

        <div class="flex items-center gap-2 mb-2">
          <input
            v-model="search"
            type="search"
            placeholder="Find a player…"
            class="flex-1 max-w-xs rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span class="text-[10px] text-zinc-600 tabular-nums ml-auto">
            {{ rows.length.toLocaleString() }} shown
          </span>
        </div>

        <ul class="card divide-y divide-zinc-900/60 overflow-hidden">
          <li
            v-for="p in listRows"
            :key="p.player_name"
            class="relative hover:bg-zinc-900/40 transition-colors"
          >
            <!-- Points bar, scaled against the leader -->
            <span
              class="absolute inset-y-0 left-0 bg-accent/[0.07] pointer-events-none"
              :style="{ width: barMax ? `${(barOf(p) / barMax) * 100}%` : '0%' }"
              aria-hidden="true"
            />
            <div class="relative px-3 sm:px-4 py-2.5 flex items-center gap-3 text-sm">
              <span class="rank-badge shrink-0" :class="rankBadge(p.rank)">#{{ p.rank }}</span>
              <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 flex items-center justify-center">
                <img v-if="avatar(p)" :src="avatar(p)!" class="w-full h-full object-cover" alt="" />
                <span v-else class="text-[11px] font-bold uppercase text-zinc-500">{{ p.player_name.charAt(0) }}</span>
              </span>
              <div class="min-w-0 flex-1">
                <NuxtLink
                  v-if="profile(p)"
                  :to="profile(p)!"
                  class="block truncate font-medium text-zinc-100 hover:text-accent transition-colors"
                >{{ p.player_name }}</NuxtLink>
                <span v-else class="block truncate font-medium text-zinc-100">{{ p.player_name }}</span>
                <span v-if="p.hardest_name" class="block truncate text-[10px] text-zinc-600">
                  hardest: #{{ p.hardest_rank }} {{ p.hardest_name }}
                </span>
              </div>
              <span class="shrink-0 hidden sm:flex items-center gap-1.5 text-[10px] tabular-nums">
                <span class="rounded px-1.5 py-0.5 bg-emerald-950/60 text-emerald-300 border border-emerald-900/60">
                  {{ p.completions }} done
                </span>
                <span
                  v-if="p.progresses"
                  class="rounded px-1.5 py-0.5 bg-amber-950/60 text-amber-300 border border-amber-900/60"
                >{{ p.progresses }} prog</span>
              </span>
              <span class="shrink-0 tabular-nums text-amber-300 font-semibold w-20 text-right">
                {{ fmt(p.points) }}
              </span>
            </div>
          </li>
          <li v-if="emptyReason === 'search'" class="px-4 py-10 text-center text-xs text-zinc-500">
            No players match “{{ search.trim() }}”.
          </li>
          <li v-else-if="emptyReason === 'all-on-podium'" class="px-4 py-8 text-center text-xs text-zinc-600">
            That's everyone so far.
          </li>
        </ul>
      </template>
    </template>
  </CustomListShell>
</template>

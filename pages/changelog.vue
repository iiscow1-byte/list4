<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type Change = {
  kind: 'add' | 'move'
  level_id: number
  level_position: number
  level_name: string
  level_gddl_tier: string | null
  level_rated: string | null
  challenge_rank: number | null
  from_challenge_rank: number | null
  from_position: number | null
  to_position: number
  from_placement: number | null
  to_placement: number | null
  changed_at: string
  changed_by: string | null
  source: string
  raw_from_position: number | null
  raw_to_position: number | null
}
type ChangesDay = { date: string; changes: Change[] }
type Changes = { days: ChangesDay[] }

const { data: meRes } = useCurrentUser()
const isMod = computed(() => {
  const r = meRes.value?.account?.role
  return r === 'moderator' || r === 'admin' || r === 'owner' || r === 'developer'
})

// `source` filters server-side; `range` widens the window far enough back to
// cover the imported AREDL history (which reaches to 2016-ish).
const sourceFilter = ref<'' | 'all' | 'aredl'>('')
const range = ref(30)
const RANGES = [
  { value: 14,   label: '14 days' },
  { value: 30,   label: '30 days' },
  { value: 180,  label: '6 months' },
  { value: 365,  label: '1 year' },
  { value: 3650, label: 'All time' },
]

const { data: changes, refresh: refreshChanges } = await useFetch<Changes>('/api/changes/recent', {
  query: computed(() => ({
    days: range.value,
    limit: 2000,
    source: sourceFilter.value || undefined,
  })),
})

const changelogView = ref<'all' | 'challenge'>('all')
const changelogOrder = ref<'placement' | 'recent'>('recent')

function filteredChanges(list: Change[]) {
  const base = changelogView.value === 'challenge'
    ? list.filter((c) => c.level_rated === 'Challenge')
    : list
  if (changelogOrder.value === 'recent') return base
  if (changelogView.value === 'challenge') {
    return [...base].sort((a, b) => (a.challenge_rank ?? 9999) - (b.challenge_rank ?? 9999))
  }
  return [...base].sort((a, b) => a.to_position - b.to_position)
}

const totalShown = computed(() =>
  (changes.value?.days ?? []).reduce((n, d) => n + filteredChanges(d.changes).length, 0),
)

async function deleteChange(c: Change) {
  const date = c.changed_at.slice(0, 10)
  if (!confirm(`Remove changelog entry for "${c.level_name}" on ${date}?`)) return
  try {
    await $fetch(`/api/admin/changes/${c.level_id}`, { method: 'DELETE', query: { date } })
    await refreshChanges()
  } catch (e: any) {
    alert(e?.data?.statusMessage ?? 'Failed to delete.')
  }
}

function shortTier(tier: string | null): string | null {
  if (!tier) return null
  const t = tier.match(/^Tier (\d{1,2})$/)
  if (t) return t[1]!
  const s = tier.match(/^Subtier (\d{1,2})$/)
  if (s) return `S${s[1]}`
  return tier
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

useHead({ title: 'Changelog — All Levels List' })
</script>

<template>
  <div class="container-wide py-8 space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Changelog</h1>
        <p class="text-sm text-zinc-500 mt-1">
          Placements and movements on the ALL list, including history imported from AREDL
          and converted to ALL placements.
        </p>
      </div>
      <span class="text-[11px] text-zinc-600 tabular-nums">{{ totalShown.toLocaleString() }} entries</span>
    </header>

    <!-- Controls -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
        <button
          v-for="opt in [{ v: '', l: 'All sources' }, { v: 'all', l: 'ALL native' }, { v: 'aredl', l: 'AREDL history' }]"
          :key="opt.v"
          type="button"
          class="px-3 py-1 text-[11px] font-medium transition-colors border-l border-zinc-800 first:border-l-0"
          :class="sourceFilter === opt.v ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="sourceFilter = opt.v as any"
        >{{ opt.l }}</button>
      </div>

      <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
        <button
          v-for="r in RANGES"
          :key="r.value"
          type="button"
          class="px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-zinc-800 first:border-l-0"
          :class="range === r.value ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="range = r.value"
        >{{ r.label }}</button>
      </div>

      <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
        <button
          type="button"
          class="px-2.5 py-1 text-[11px] font-medium transition-colors"
          :class="changelogView === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="changelogView = 'all'"
        >All levels</button>
        <button
          type="button"
          class="px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-zinc-800"
          :class="changelogView === 'challenge' ? 'bg-amber-900/60 text-amber-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="changelogView = 'challenge'"
        >Challenges</button>
      </div>

      <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden ml-auto">
        <button
          type="button"
          class="px-2.5 py-1 text-[11px] font-medium transition-colors"
          :class="changelogOrder === 'recent' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="changelogOrder = 'recent'"
        >Recent</button>
        <button
          type="button"
          class="px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-zinc-800"
          :class="changelogOrder === 'placement' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="changelogOrder = 'placement'"
        >Placement</button>
      </div>
    </div>

    <!-- Days -->
    <div class="space-y-4">
      <template v-for="day in changes?.days ?? []" :key="day.date">
        <div v-if="filteredChanges(day.changes).length" class="card overflow-hidden">
          <div class="px-4 py-2.5 border-b border-zinc-800/80 flex items-baseline justify-between gap-3">
            <h2 class="text-sm font-semibold text-zinc-100">{{ formatDay(day.date) }}</h2>
            <span class="text-[11px] text-zinc-500 tabular-nums">
              {{ filteredChanges(day.changes).length }} change{{ filteredChanges(day.changes).length === 1 ? '' : 's' }}
            </span>
          </div>
          <ul class="divide-y divide-zinc-900/60">
            <li
              v-for="(c, i) in filteredChanges(day.changes)"
              :key="`${day.date}-${i}`"
              class="px-4 py-2 text-sm flex items-center gap-2 group/row hover:bg-zinc-900/40 transition-colors"
            >
              <span
                v-if="c.kind === 'add'"
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-emerald-950/60 text-emerald-300 border border-emerald-900/60"
                title="Added to the list"
              >Added</span>
              <span
                v-else-if="c.from_position != null && c.to_position < c.from_position"
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-950/60 text-sky-300 border border-sky-900/60"
                title="Moved up"
              >▲ Moved</span>
              <span
                v-else
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-950/60 text-amber-300 border border-amber-900/60"
                title="Moved down"
              >▼ Moved</span>

              <NuxtLink
                :to="`/levels/${c.level_position}`"
                class="truncate text-zinc-200 hover:text-accent transition-colors"
              >{{ c.level_name }}</NuxtLink>

              <span
                v-if="c.level_gddl_tier && changelogView !== 'challenge'"
                class="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold leading-none"
                :style="{ backgroundColor: tierColor(c.level_gddl_tier), color: textOn(tierColor(c.level_gddl_tier)) }"
                :title="c.level_gddl_tier"
              >{{ shortTier(c.level_gddl_tier) }}</span>

              <span
                v-if="c.source === 'aredl'"
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-950/50 text-sky-300/90 border border-sky-900/60"
                :title="c.raw_to_position != null
                  ? `From AREDL history — AREDL ${c.raw_from_position != null ? '#' + c.raw_from_position + ' → ' : ''}#${c.raw_to_position}, converted to ALL placements`
                  : 'Imported from AREDL history, converted to ALL placements'"
              >AREDL</span>

              <span class="shrink-0 text-base font-semibold tabular-nums text-zinc-300 ml-auto">
                <template v-if="changelogView === 'challenge'">
                  <template v-if="c.kind === 'add'">
                    <span class="text-amber-300">Ch. #{{ c.challenge_rank }}</span>
                  </template>
                  <template v-else>
                    <span class="text-zinc-500">Ch. #{{ c.from_challenge_rank }}</span>
                    <span class="text-zinc-600 mx-1">→</span>
                    <span class="text-amber-300">Ch. #{{ c.challenge_rank }}</span>
                  </template>
                </template>
                <template v-else>
                  <template v-if="c.kind === 'add'">#{{ c.to_placement }}</template>
                  <template v-else>
                    <span class="text-zinc-500">#{{ c.from_placement }}</span>
                    <span class="text-zinc-600 mx-1">→</span>
                    <span class="text-accent">#{{ c.to_placement }}</span>
                  </template>
                </template>
              </span>

              <button
                v-if="isMod"
                type="button"
                class="shrink-0 text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover/row:opacity-100 leading-none"
                title="Remove changelog entry"
                @click="deleteChange(c)"
              >✕</button>
            </li>
          </ul>
        </div>
      </template>

      <p v-if="totalShown === 0" class="text-sm text-zinc-500 py-6 text-center">
        No changes in this range.
      </p>
    </div>
  </div>
</template>

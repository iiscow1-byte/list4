<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type Change = {
  kind: 'add' | 'move'
  level_id: number
  level_position: number
  level_name: string
  level_gddl_tier: string | null
  level_rated: string | null
  level_gd_id?: number | null
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
  { value: 14,   label: '14d' },
  { value: 30,   label: '30d' },
  { value: 180,  label: '6mo' },
  { value: 365,  label: '1y' },
  { value: 3650, label: 'All' },
]

const { data: changes, pending, refresh: refreshChanges } = await useFetch<Changes>('/api/changes/recent', {
  query: computed(() => ({
    days: range.value,
    limit: 2000,
    source: sourceFilter.value || undefined,
  })),
})

const changelogView = ref<'all' | 'challenge'>('all')
const changelogOrder = ref<'placement' | 'recent'>('recent')
/** Only additions, only movements, or both. */
const kindFilter = ref<'' | 'add' | 'move'>('')
const search = ref('')
const dense = ref(false)

function filteredChanges(list: Change[]) {
  let base = changelogView.value === 'challenge'
    ? list.filter((c) => c.level_rated === 'Challenge')
    : list
  if (kindFilter.value) base = base.filter((c) => c.kind === kindFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) base = base.filter((c) => c.level_name.toLowerCase().includes(q))
  if (changelogOrder.value === 'recent') return base
  if (changelogView.value === 'challenge') {
    return [...base].sort((a, b) => (a.challenge_rank ?? 9999) - (b.challenge_rank ?? 9999))
  }
  return [...base].sort((a, b) => a.to_position - b.to_position)
}

/** How far a level moved, in placements — the number people actually want. */
function delta(c: Change): number | null {
  if (c.kind === 'add') return null
  const from = c.from_placement ?? c.from_position
  const to = c.to_placement ?? c.to_position
  if (from == null || to == null) return null
  return from - to // positive = moved up the list
}

/**
 * Filter and tally in one pass, cached per fetch/filter change. The per-day
 * summary chips are read three times each in the template — recomputing them
 * there would rescan a 2000-row log on every render.
 */
const days = computed(() =>
  (changes.value?.days ?? [])
    .map((d) => {
      const rows = filteredChanges(d.changes)
      let added = 0, up = 0, down = 0
      for (const c of rows) {
        if (c.kind === 'add') added++
        else if ((delta(c) ?? 0) > 0) up++
        else down++
      }
      return { date: d.date, changes: rows, added, up, down }
    })
    .filter((d) => d.changes.length),
)

const totalShown = computed(() => days.value.reduce((n, d) => n + d.changes.length, 0))

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
  const date = new Date(Date.UTC(y, m - 1, d))
  const today = new Date()
  const isToday = date.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)
  if (isToday) return 'Today'
  return date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

const segBtn = 'px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-zinc-800 first:border-l-0'
const segOn = 'bg-zinc-800 text-zinc-100'
const segOff = 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'

useHead({ title: 'Changelog — All Levels List' })
</script>

<template>
  <div class="container-wide py-8">
    <header class="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Changelog</h1>
        <p class="text-sm text-zinc-500 mt-1 max-w-2xl">
          Every placement and movement on the ALL list, including history imported from
          AREDL and converted to ALL placements. Website changes live on
          <NuxtLink to="/updates" class="text-accent hover:underline">List updates</NuxtLink>.
        </p>
      </div>
      <span class="text-[11px] text-zinc-600 tabular-nums">
        {{ totalShown.toLocaleString() }} entr{{ totalShown === 1 ? 'y' : 'ies' }}
        <template v-if="pending"> · loading…</template>
      </span>
    </header>

    <!-- Controls: sticky so filtering stays reachable while reading a long log -->
    <div class="sticky top-14 z-20 -mx-2 px-2 py-2 mb-4 bg-zinc-950/85 backdrop-blur-md border-b border-zinc-800/70">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative min-w-[10rem] flex-1 max-w-xs">
          <input
            v-model="search"
            type="search"
            placeholder="Filter by level name…"
            class="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[12px] placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
          <button
            v-for="opt in [{ v: '', l: 'Everything' }, { v: 'add', l: 'Added' }, { v: 'move', l: 'Moved' }]"
            :key="opt.v"
            type="button"
            :class="[segBtn, kindFilter === opt.v ? segOn : segOff]"
            @click="kindFilter = opt.v as any"
          >{{ opt.l }}</button>
        </div>

        <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
          <button
            v-for="opt in [{ v: '', l: 'All sources' }, { v: 'all', l: 'ALL native' }, { v: 'aredl', l: 'AREDL' }]"
            :key="opt.v"
            type="button"
            :class="[segBtn, sourceFilter === opt.v ? segOn : segOff]"
            @click="sourceFilter = opt.v as any"
          >{{ opt.l }}</button>
        </div>

        <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
          <button
            v-for="r in RANGES"
            :key="r.value"
            type="button"
            :class="[segBtn, range === r.value ? segOn : segOff]"
            @click="range = r.value"
          >{{ r.label }}</button>
        </div>

        <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
          <button
            type="button"
            :class="[segBtn, changelogView === 'all' ? segOn : segOff]"
            @click="changelogView = 'all'"
          >All levels</button>
          <button
            type="button"
            :class="[segBtn, changelogView === 'challenge' ? 'bg-amber-900/60 text-amber-200' : segOff]"
            @click="changelogView = 'challenge'"
          >Challenges</button>
        </div>

        <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden ml-auto">
          <button
            type="button"
            :class="[segBtn, changelogOrder === 'recent' ? segOn : segOff]"
            @click="changelogOrder = 'recent'"
          >Recent</button>
          <button
            type="button"
            :class="[segBtn, changelogOrder === 'placement' ? segOn : segOff]"
            @click="changelogOrder = 'placement'"
          >Placement</button>
        </div>

        <button
          type="button"
          class="rounded-lg border border-zinc-800 px-2.5 py-1 text-[11px] font-medium transition-colors"
          :class="dense ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          :aria-pressed="dense"
          title="Tighter rows, no level art"
          @click="dense = !dense"
        >Compact</button>
      </div>
    </div>

    <!-- Days -->
    <div class="space-y-4">
      <section v-for="day in days" :key="day.date" class="card overflow-hidden">
        <div class="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between gap-3 flex-wrap">
          <h2 class="text-sm font-semibold text-zinc-100">{{ formatDay(day.date) }}</h2>
          <div class="flex items-center gap-1.5 text-[10px] tabular-nums">
            <span
              v-if="day.added"
              class="rounded px-1.5 py-0.5 bg-emerald-950/60 text-emerald-300 border border-emerald-900/60"
            >+{{ day.added }} added</span>
            <span
              v-if="day.up"
              class="rounded px-1.5 py-0.5 bg-sky-950/60 text-sky-300 border border-sky-900/60"
            >▲ {{ day.up }}</span>
            <span
              v-if="day.down"
              class="rounded px-1.5 py-0.5 bg-amber-950/60 text-amber-300 border border-amber-900/60"
            >▼ {{ day.down }}</span>
          </div>
        </div>

        <ul class="divide-y divide-zinc-900/60">
          <li
            v-for="(c, i) in day.changes"
            :key="`${day.date}-${i}`"
            class="relative overflow-hidden group/row hover:bg-zinc-900/40 transition-colors"
          >
            <LevelThumbBg
              v-if="!dense"
              :gd-id="c.level_gd_id ?? null"
              res="small"
              img-class="opacity-[0.13] group-hover/row:opacity-25"
              overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
            />
            <div
              class="relative px-4 flex items-center gap-2.5 text-sm"
              :class="dense ? 'py-1' : 'py-2'"
            >
              <span
                v-if="c.kind === 'add'"
                class="shrink-0 w-[4.6rem] text-center text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-emerald-950/60 text-emerald-300 border border-emerald-900/60"
                title="Added to the list"
              >Added</span>
              <span
                v-else-if="(delta(c) ?? 0) > 0"
                class="shrink-0 w-[4.6rem] text-center text-[10px] tabular-nums px-1.5 py-px rounded bg-sky-950/60 text-sky-300 border border-sky-900/60"
                title="Moved up the list"
              >▲ {{ delta(c) }}</span>
              <span
                v-else
                class="shrink-0 w-[4.6rem] text-center text-[10px] tabular-nums px-1.5 py-px rounded bg-amber-950/60 text-amber-300 border border-amber-900/60"
                title="Moved down the list"
              >▼ {{ Math.abs(delta(c) ?? 0) }}</span>

              <NuxtLink
                :to="`/levels/${c.level_position}`"
                class="truncate font-medium text-zinc-200 hover:text-accent transition-colors"
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

              <span class="shrink-0 font-semibold tabular-nums text-zinc-300 ml-auto" :class="dense ? 'text-sm' : 'text-base'">
                <template v-if="changelogView === 'challenge'">
                  <template v-if="c.kind === 'add'">
                    <span class="text-amber-300">Ch. #{{ c.challenge_rank }}</span>
                  </template>
                  <template v-else>
                    <span class="text-zinc-600">Ch. #{{ c.from_challenge_rank }}</span>
                    <span class="text-zinc-700 mx-1">→</span>
                    <span class="text-amber-300">Ch. #{{ c.challenge_rank }}</span>
                  </template>
                </template>
                <template v-else>
                  <template v-if="c.kind === 'add'">#{{ c.to_placement }}</template>
                  <template v-else>
                    <span class="text-zinc-600">#{{ c.from_placement }}</span>
                    <span class="text-zinc-700 mx-1">→</span>
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
            </div>
          </li>
        </ul>
      </section>

      <p v-if="!pending && totalShown === 0" class="text-sm text-zinc-500 py-16 text-center">
        No changes match these filters.
      </p>
    </div>
  </div>
</template>

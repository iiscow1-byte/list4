<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type Change = {
  kind: 'add' | 'move' | 'remove'
  level_id: number
  /** Null on a removal — there is no level page left to link to. */
  level_position: number | null
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
}
type ChangesDay = { date: string; changes: Change[] }
type Changes = { days: ChangesDay[] }

const { data: meRes } = useCurrentUser()
const isMod = computed(() => {
  const r = meRes.value?.account?.role
  return r === 'moderator' || r === 'admin' || r === 'owner' || r === 'developer'
})

// The changelog is this list's own movements only. There used to be a source
// filter here because AREDL's history was imported into it; that history now
// lives on each level's graph instead, where it is one site's ranking beside
// another's rather than an entry claiming the ALL moved.
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
  })),
})

const changelogView = ref<'all' | 'challenge'>('all')
const changelogOrder = ref<'placement' | 'recent'>('recent')
/** Only additions, only movements, or both. */
const kindFilter = ref<'' | 'add' | 'move' | 'remove'>('')
const search = ref('')
const dense = ref(false)

function filteredChanges(list: Change[]) {
  let base = changelogView.value === 'challenge'
    // A challenge that slid down the main list past four non-challenges is at
    // the same challenge rank it started at, and `loadChanges` cannot drop it
    // because on the list *it* is filtering, the level did move. Reading the
    // challenge changelog, it is a row that says `Ch. #12 → Ch. #12`.
    ? list.filter((c) => c.level_rated === 'Challenge' && delta(c) !== 0)
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

/**
 * How far a level moved, in whichever list is being read.
 *
 * This used to be the classic placements always, including in the challenge
 * view — where the row beside it reads `Ch. #14 → Ch. #11`. So the badge was
 * measuring one list and the numbers next to it another, and the two disagreed
 * routinely rather than occasionally: the challenge list is a renumbering of a
 * sparse subset, so a level that slides four places down the main list past
 * four non-challenges has not moved on the challenge list at all, and one that
 * holds its main placement while a challenge above it is removed has moved up
 * without moving. The badge could also point the *wrong way* — down the main
 * list is up the challenge list whenever the levels overtaking you aren't
 * challenges.
 *
 * Positive means moved up.
 */
function delta(c: Change): number | null {
  // A removal isn't a move in either direction, so it gets no arrow.
  if (c.kind !== 'move') return null
  const [from, to] = changelogView.value === 'challenge'
    ? [c.from_challenge_rank, c.challenge_rank]
    : [c.from_placement ?? c.from_position, c.to_placement ?? c.to_position]
  if (from == null || to == null) return null
  return from - to
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
      let added = 0, up = 0, down = 0, removed = 0
      for (const c of rows) {
        if (c.kind === 'add') added++
        else if (c.kind === 'remove') removed++
        else if ((delta(c) ?? 0) > 0) up++
        else down++
      }
      return { date: d.date, changes: rows, added, up, down, removed }
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

/**
 * The four filter rows are `SegmentedControl` now — same shape, same sizes, and
 * each one finally tells a screen reader which option is on.
 *
 * The bridges below exist because the control speaks plain strings while these
 * refs are a number and three unions. Converting at the boundary keeps the
 * page's own types honest instead of widening them to suit a component.
 */
const kindModel = computed({
  get: () => kindFilter.value as string,
  set: (v: string) => { kindFilter.value = v as typeof kindFilter.value },
})
const rangeModel = computed({
  get: () => String(range.value),
  set: (v: string) => { range.value = Number(v) },
})
const viewModel = computed({
  get: () => changelogView.value as string,
  set: (v: string) => { changelogView.value = v as typeof changelogView.value },
})
const orderModel = computed({
  get: () => changelogOrder.value as string,
  set: (v: string) => { changelogOrder.value = v as typeof changelogOrder.value },
})

useHead({ title: 'Changelog — All Levels List' })
</script>

<template>
  <div class="container-wide py-8">
    <header class="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Changelog</h1>
        <p class="text-sm text-zinc-500 mt-1 max-w-2xl">
          Every placement and move on the ALL list. Website changes live on
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
            class="field field-sm text-[12px]"
          />
        </div>

        <SegmentedControl
          v-model="kindModel"
          aria-label="Kind of change"
          :options="[
            { value: '', label: 'Everything' },
            { value: 'add', label: 'Added' },
            { value: 'move', label: 'Moved' },
            { value: 'remove', label: 'Removed' },
          ]"
        />

        <SegmentedControl
          v-model="rangeModel"
          aria-label="How far back"
          :options="RANGES.map((r) => ({ value: String(r.value), label: r.label }))"
        />

        <SegmentedControl
          v-model="viewModel"
          aria-label="Which levels"
          :options="[
            { value: 'all', label: 'All levels' },
            { value: 'challenge', label: 'Challenges' },
          ]"
        />

        <SegmentedControl
          v-model="orderModel"
          aria-label="Order"
          class="ml-auto"
          :options="[
            { value: 'recent', label: 'Recent' },
            { value: 'placement', label: 'Placement' },
          ]"
        />

        <button
          type="button"
          class="rounded-lg border border-zinc-800 px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
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
            <span
              v-if="day.removed"
              class="rounded px-1.5 py-0.5 bg-red-950/60 text-red-300 border border-red-900/60"
            >−{{ day.removed }} removed</span>
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
                v-else-if="c.kind === 'remove'"
                class="shrink-0 w-[4.6rem] text-center text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-red-950/60 text-red-300 border border-red-900/60"
                title="Removed from the list"
              >Removed</span>
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

              <!-- A removed level has no page. Plain text rather than a link
                   to `/levels/null`, and struck through so the row reads as
                   what it is at a glance. -->
              <NuxtLink
                v-if="c.level_position != null"
                :to="`/levels/${c.level_position}`"
                class="truncate font-medium text-zinc-200 hover:text-accent transition-colors"
              >{{ c.level_name }}</NuxtLink>
              <span v-else class="truncate font-medium text-zinc-500 line-through decoration-red-900/70">{{ c.level_name }}</span>

              <span
                v-if="c.level_gddl_tier && changelogView !== 'challenge'"
                class="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold leading-none"
                :style="{ backgroundColor: tierColor(c.level_gddl_tier), color: textOn(tierColor(c.level_gddl_tier)) }"
                :title="c.level_gddl_tier"
              >{{ shortTier(c.level_gddl_tier) }}</span>

              <span class="shrink-0 font-semibold tabular-nums text-zinc-300 ml-auto" :class="dense ? 'text-sm' : 'text-base'">
                <!-- A removal has one placement, not two: the one it was
                     standing on when it went. Drawing it as `#12 → #12` would
                     claim a move that didn't happen. -->
                <template v-if="changelogView === 'challenge'">
                  <template v-if="c.kind === 'add'">
                    <span class="text-amber-300">Ch. #{{ c.challenge_rank }}</span>
                  </template>
                  <template v-else-if="c.kind === 'remove'">
                    <span class="text-zinc-600 line-through">Ch. #{{ c.challenge_rank }}</span>
                  </template>
                  <template v-else>
                    <span class="text-zinc-600">Ch. #{{ c.from_challenge_rank }}</span>
                    <span class="text-zinc-700 mx-1">→</span>
                    <span class="text-amber-300">Ch. #{{ c.challenge_rank }}</span>
                  </template>
                </template>
                <template v-else>
                  <template v-if="c.kind === 'add'">#{{ c.to_placement }}</template>
                  <template v-else-if="c.kind === 'remove'">
                    <span class="text-zinc-600 line-through">#{{ c.to_placement }}</span>
                  </template>
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
                class="shrink-0 text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                title="Remove changelog entry"
                aria-label="Remove changelog entry"
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

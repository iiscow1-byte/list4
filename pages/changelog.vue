<script setup lang="ts">
import { tierColor } from '~/utils/tier-colors'

type Change = {
  kind: 'add' | 'move' | 'remove'
  level_id: number
  /** Null on a removal — there is no level page left to link to. */
  level_position: number | null
  level_name: string
  level_gddl_tier: string | null
  level_rated: string | null
  challenge_rank: number | null
  from_challenge_rank: number | null
  from_position: number | null
  to_position: number
  changed_at: string
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
    : [c.from_position, c.to_position]
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

/**
 * Rows drawn so far. A busy month is a couple of thousand changes, and drawing
 * every one up front made this the heaviest page on the site. The rest are
 * drawn as the reader scrolls toward them.
 */
const STEP = 200
const drawn = ref(STEP)
watch([range, changelogView, changelogOrder, kindFilter, search], () => { drawn.value = STEP })

const visibleDays = computed(() => {
  let left = drawn.value
  const out: ((typeof days.value)[number] & { rows: Change[] })[] = []
  for (const d of days.value) {
    if (left <= 0) break
    const rows = d.changes.length > left ? d.changes.slice(0, left) : d.changes
    out.push({ ...d, rows })
    left -= rows.length
  }
  return out
})
const hasMore = computed(() => drawn.value < totalShown.value)

const moreEl = ref<HTMLElement | null>(null)
let moreObserver: IntersectionObserver | null = null
function drawMore() {
  if (!hasMore.value) return
  drawn.value += STEP
  // An observer only reports changes, and on a tall screen the marker can
  // still be in range after the new rows draw. Observing it again re-checks.
  nextTick(() => {
    if (!moreEl.value || !moreObserver) return
    moreObserver.unobserve(moreEl.value)
    moreObserver.observe(moreEl.value)
  })
}
onMounted(() => {
  moreObserver = new IntersectionObserver(
    (entries) => { if (entries.some((e) => e.isIntersecting)) drawMore() },
    { rootMargin: '1200px 0px' },
  )
  if (moreEl.value) moreObserver.observe(moreEl.value)
})
onBeforeUnmount(() => moreObserver?.disconnect())

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

/** Where the level is now, in the list being read. Nothing for a removal. */
function rankLabel(c: Change): string {
  if (c.kind === 'remove') return ''
  const n = changelogView.value === 'challenge' ? c.challenge_rank : c.to_position
  return n != null ? `#${n}` : ''
}

function detailLabel(c: Change): string {
  const challenge = changelogView.value === 'challenge'
  if (c.kind === 'add') return 'added'
  if (c.kind === 'remove') return `was #${challenge ? c.challenge_rank : c.to_position}`
  return `from #${challenge ? c.from_challenge_rank : c.from_position}`
}

function daySummary(d: { added: number; up: number; down: number; removed: number }): string {
  const parts: string[] = []
  if (d.added) parts.push(`${d.added.toLocaleString()} added`)
  if (d.up) parts.push(`${d.up.toLocaleString()} up`)
  if (d.down) parts.push(`${d.down.toLocaleString()} down`)
  if (d.removed) parts.push(`${d.removed.toLocaleString()} removed`)
  return parts.join(' · ')
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
    <header class="mb-5">
      <h1 class="page-title">Changelog</h1>
      <p class="page-lead">Every level added, moved or removed. Site changes are on <NuxtLink to="/updates" class="link">List updates</NuxtLink>.</p>
    </header>

    <div class="sticky top-14 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-5 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 flex flex-wrap items-center gap-2">
      <input v-model="search" type="search" placeholder="Find a level" aria-label="Find a level" class="field field-sm w-full sm:w-56" />
      <SegmentedControl
        v-model="kindModel"
        aria-label="Kind of change"
        :options="[
          { value: '', label: 'All' },
          { value: 'add', label: 'Added' },
          { value: 'move', label: 'Moved' },
          { value: 'remove', label: 'Removed' },
        ]"
      />
      <select v-model="rangeModel" class="field field-sm w-auto text-xs" aria-label="How far back">
        <option v-for="r in RANGES" :key="r.value" :value="String(r.value)">{{ r.value >= 3650 ? 'All time' : `Last ${r.label}` }}</option>
      </select>
      <SegmentedControl
        v-model="viewModel"
        aria-label="Which levels"
        :options="[
          { value: 'all', label: 'All levels' },
          { value: 'challenge', label: 'Challenges' },
        ]"
      />
      <select v-model="orderModel" class="field field-sm w-auto text-xs sm:ml-auto" aria-label="Order">
        <option value="recent">Newest first</option>
        <option value="placement">By placement</option>
      </select>
      <span class="text-xs text-zinc-500 tabular-nums">{{ pending ? 'Loading…' : `${totalShown.toLocaleString()} changes` }}</span>
    </div>

    <div class="space-y-8">
      <section v-for="day in visibleDays" :key="day.date">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
          <h2 class="section-title">{{ formatDay(day.date) }}</h2>
          <span class="text-xs text-zinc-500">{{ daySummary(day) }}</span>
        </div>
        <ul class="rounded-lg border border-zinc-800 divide-y divide-zinc-800/70 overflow-hidden">
          <li
            v-for="(c, i) in day.rows"
            :key="`${day.date}-${i}`"
            class="group flex items-center gap-3 px-3 sm:px-4 py-2 text-sm hover:bg-zinc-900/60 transition-colors"
          >
            <span class="w-10 sm:w-12 shrink-0 text-xs font-semibold tabular-nums">
              <span v-if="c.kind === 'add'" class="text-emerald-400">New</span>
              <span v-else-if="c.kind === 'remove'" class="text-rose-400">Out</span>
              <span v-else-if="(delta(c) ?? 0) > 0" class="text-emerald-400">▲ {{ delta(c) }}</span>
              <span v-else class="text-rose-400">▼ {{ Math.abs(delta(c) ?? 0) }}</span>
            </span>

            <span class="hidden sm:block rank w-16 shrink-0 text-right text-zinc-300">{{ rankLabel(c) }}</span>

            <span
              class="hidden sm:block w-2 h-2 rounded-sm shrink-0"
              :style="c.level_gddl_tier ? { backgroundColor: tierColor(c.level_gddl_tier) } : undefined"
              :title="c.level_gddl_tier ?? undefined"
            />
            <!-- On a phone the numbers go under the name, which would otherwise
                 get a few letters between them. -->
            <div class="min-w-0 flex-1">
              <NuxtLink
                v-if="c.level_position != null"
                :to="`/levels/${c.level_position}`"
                class="block truncate font-medium text-zinc-100 hover:text-accent transition-colors"
              >{{ c.level_name }}</NuxtLink>
              <span v-else class="block truncate font-medium text-zinc-500 line-through decoration-zinc-600">{{ c.level_name }}</span>
              <span class="sm:hidden block text-xs text-zinc-500 tabular-nums">
                <template v-if="rankLabel(c)">{{ rankLabel(c) }} · </template>{{ detailLabel(c) }}
              </span>
            </div>

            <span class="hidden sm:block shrink-0 text-xs text-zinc-500 tabular-nums">{{ detailLabel(c) }}</span>

            <button
              v-if="isMod"
              type="button"
              class="shrink-0 w-6 h-6 rounded text-zinc-600 hover:text-red-300 hover:bg-zinc-800 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title="Remove this entry"
              aria-label="Remove this entry"
              @click="deleteChange(c)"
            >×</button>
          </li>
        </ul>
      </section>

      <p v-if="!pending && totalShown === 0" class="py-16 text-center text-sm text-zinc-500">
        Nothing matches.
      </p>
    </div>

    <div ref="moreEl" class="py-6 text-center">
      <button v-if="hasMore" type="button" class="btn btn-sm btn-ghost" @click="drawMore">
        Show more
      </button>
    </div>
  </div>
</template>

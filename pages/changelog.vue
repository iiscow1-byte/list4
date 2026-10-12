<script setup lang="ts">
type Change = {
  kind: 'add' | 'move' | 'remove'
  level_id: number
  /** Null on a removal: there is no level page left to link to. */
  level_position: number | null
  level_name: string
  level_gddl_tier: string | null
  level_gd_id?: number | null
  level_rated: string | null
  challenge_rank: number | null
  from_challenge_rank: number | null
  from_position: number | null
  to_position: number
  changed_at: string
}
type ChangesDay = { date: string; changes: Change[] }
type Changes = { days: ChangesDay[] }
type Kind = Change['kind']

const { data: meRes } = useCurrentUser()
const isMod = computed(() => {
  const r = meRes.value?.account?.role
  return r === 'moderator' || r === 'admin' || r === 'owner' || r === 'developer'
})
const showThumbs = useShowThumbnails()
const { locale } = useLocale()

// The changelog is this list's own movements only. AREDL's history is on each
// level's placement history instead.
const range = ref(30)
const RANGES = [
  { value: 14,   label: 'Last 14 days' },
  { value: 30,   label: 'Last 30 days' },
  { value: 180,  label: 'Last 6 months' },
  { value: 365,  label: 'Last year' },
  { value: 3650, label: 'All time' },
]

const { data: changes, pending, refresh: refreshChanges } = await useFetch<Changes>('/api/changes/recent', {
  query: computed(() => ({
    days: range.value,
    limit: 2000,
  })),
})

const changelogView = ref<'all' | 'challenge'>('all')
const changelogOrder = ref<'placement' | 'recent'>('recent')
const kindFilter = ref<'' | Kind>('')
const search = ref('')

function filteredChanges(list: Change[]) {
  let base = changelogView.value === 'challenge'
    // A challenge that slid down the main list past non-challenges hasn't moved
    // on the challenge list, and would read "Challenge #12 → #12".
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
 * How far a level moved, in whichever list is being read: the main list, or
 * the challenge list, which is a renumbering of a subset and moves differently.
 * Positive means up.
 */
function delta(c: Change): number | null {
  if (c.kind !== 'move') return null
  const [from, to] = changelogView.value === 'challenge'
    ? [c.from_challenge_rank, c.challenge_rank]
    : [c.from_position, c.to_position]
  if (from == null || to == null) return null
  return from - to
}

// ---------------------------------------------------------------- days and sections

/**
 * A day is shown as up to three sections, moves first: a sheet refresh can add
 * a thousand levels in a day, and the few that actually moved are what most
 * people come here to read. Long sections show their first rows and open on
 * request.
 */
const SECTION_ORDER: Kind[] = ['move', 'add', 'remove']
const SECTION_LABEL: Record<Kind, string> = { move: 'Moved', add: 'Added', remove: 'Removed' }
const SECTION_CAP = 10
const opened = ref(new Set<string>())
function openSection(key: string) {
  opened.value = new Set([...opened.value, key])
}

const days = computed(() =>
  (changes.value?.days ?? [])
    .map((d) => {
      const rows = filteredChanges(d.changes)
      const byKind: Record<Kind, Change[]> = { move: [], add: [], remove: [] }
      let up = 0, down = 0
      for (const c of rows) {
        byKind[c.kind].push(c)
        if (c.kind === 'move') ((delta(c) ?? 0) > 0 ? up++ : down++)
      }
      const sections = SECTION_ORDER
        .filter((k) => byKind[k].length)
        .map((k) => {
          const key = `${d.date}:${k}`
          const all = byKind[k]
          const open = opened.value.has(key) || all.length <= SECTION_CAP + 3
          return { key, kind: k, total: all.length, rows: open ? all : all.slice(0, SECTION_CAP), hidden: open ? 0 : all.length - SECTION_CAP }
        })
      return {
        date: d.date,
        total: rows.length,
        added: byKind.add.length,
        removed: byKind.remove.length,
        up,
        down,
        sections,
        drawnRows: sections.reduce((n, s) => n + s.rows.length, 0),
      }
    })
    .filter((d) => d.total),
)

const totalShown = computed(() => days.value.reduce((n, d) => n + d.total, 0))

/**
 * Days drawn so far, about 200 rows' worth at a time, with more drawn as the
 * reader scrolls toward the end.
 */
const STEP = 200
const drawn = ref(STEP)
watch([range, changelogView, changelogOrder, kindFilter, search], () => {
  drawn.value = STEP
  opened.value = new Set()
})

const visibleDays = computed(() => {
  let left = drawn.value
  const out: (typeof days.value)[number][] = []
  for (const d of days.value) {
    if (left <= 0) break
    out.push(d)
    left -= d.drawnRows
  }
  return out
})
const hasMore = computed(() => visibleDays.value.length < days.value.length)

const moreEl = ref<HTMLElement | null>(null)
let moreObserver: IntersectionObserver | null = null
function drawMore() {
  if (!hasMore.value) return
  drawn.value += STEP
  // An observer only reports changes, and on a tall screen the marker can still
  // be in range after the new rows draw. Observing it again re-checks.
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
  if (!confirm(`Remove the changelog entry for "${c.level_name}" on ${date}?`)) return
  try {
    await $fetch(`/api/admin/changes/${c.level_id}`, { method: 'DELETE', query: { date } })
    await refreshChanges()
  } catch (e: any) {
    alert(e?.data?.statusMessage ?? 'Failed to delete.')
  }
}

// ---------------------------------------------------------------- labels

const n = (v: number) => v.toLocaleString(locale.value)
const challengeView = computed(() => changelogView.value === 'challenge')

/** The badge: where the level is now, or where it was when it left. */
function rankOf(c: Change): string {
  const v = challengeView.value ? c.challenge_rank : c.to_position
  return v != null ? `#${n(v)}` : '—'
}

function detailOf(c: Change): string {
  if (c.kind === 'add') return ''
  if (c.kind === 'remove') return 'removed'
  const from = challengeView.value ? c.from_challenge_rank : c.from_position
  return from != null ? `from #${n(from)}` : ''
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale.value, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

// The controls speak strings; these refs are a number and unions.
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

    <div class="sticky top-14 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-6 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 flex flex-wrap items-center gap-2">
      <input v-model="search" type="search" placeholder="Find a level" aria-label="Find a level" class="field field-sm w-full sm:w-56" />
      <SegmentedControl
        v-model="kindModel"
        aria-label="Kind of change"
        :options="[
          { value: '', label: 'All' },
          { value: 'move', label: 'Moved' },
          { value: 'add', label: 'Added' },
          { value: 'remove', label: 'Removed' },
        ]"
      />
      <SegmentedControl
        v-model="viewModel"
        aria-label="Which list"
        :options="[
          { value: 'all', label: 'Main list' },
          { value: 'challenge', label: 'Challenges' },
        ]"
      />
      <select v-model="rangeModel" class="field field-sm w-auto sm:ml-auto" aria-label="How far back">
        <option v-for="r in RANGES" :key="r.value" :value="String(r.value)">{{ r.label }}</option>
      </select>
      <select v-model="orderModel" class="field field-sm w-auto" aria-label="Order">
        <option value="recent">Newest first</option>
        <option value="placement">By rank</option>
      </select>
    </div>

    <p class="mb-4 text-sm text-zinc-500 tabular-nums">
      {{ pending ? 'Loading…' : `${n(totalShown)} ${totalShown === 1 ? 'change' : 'changes'} across ${n(days.length)} ${days.length === 1 ? 'day' : 'days'}` }}
    </p>

    <div class="space-y-6">
      <section v-for="day in visibleDays" :key="day.date" class="card overflow-hidden">
        <header class="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 border-b border-zinc-800/80">
          <h2 class="section-title">{{ formatDay(day.date) }}</h2>
          <p class="flex flex-wrap gap-x-3 text-xs tabular-nums">
            <span v-if="day.up" class="text-emerald-400">▲ {{ n(day.up) }} up</span>
            <span v-if="day.down" class="text-rose-400">▼ {{ n(day.down) }} down</span>
            <span v-if="day.added" class="text-sky-300">+ {{ n(day.added) }} added</span>
            <span v-if="day.removed" class="text-zinc-400">− {{ n(day.removed) }} removed</span>
          </p>
        </header>

        <div v-for="s in day.sections" :key="s.key" class="border-b border-zinc-800/60 last:border-b-0">
          <h3 v-if="day.sections.length > 1" class="px-4 pt-3 pb-1 text-xs font-medium text-zinc-500">
            {{ SECTION_LABEL[s.kind] }} <span class="tabular-nums">{{ n(s.total) }}</span>
          </h3>
          <ul class="p-1.5 space-y-1">
            <li v-for="(c, i) in s.rows" :key="`${s.key}-${c.level_id}-${i}`" class="list-item group/change">
              <LevelRow
                :to="c.level_position != null ? `/levels/${c.level_position}` : null"
                :rank="rankOf(c)"
                :name="c.level_name"
                :tier="c.level_gddl_tier"
                :gd-id="c.level_gd_id"
                :thumbs="showThumbs"
                :removed="c.kind === 'remove'"
                :name-class="c.kind === 'remove' ? 'truncate line-through decoration-zinc-600' : 'truncate'"
                sub-class="sm:hidden"
              >
                <template #leading>
                  <span class="w-12 text-xs font-semibold tabular-nums">
                    <span v-if="c.kind === 'add'" class="text-sky-300">New</span>
                    <span v-else-if="c.kind === 'remove'" class="text-zinc-500">Out</span>
                    <span v-else-if="(delta(c) ?? 0) > 0" class="text-emerald-400">▲ {{ n(delta(c)!) }}</span>
                    <span v-else class="text-rose-400">▼ {{ n(Math.abs(delta(c) ?? 0)) }}</span>
                  </span>
                </template>
                <!-- On a phone the detail goes under the name, which would
                     otherwise get a few letters between the numbers. -->
                <template v-if="detailOf(c)" #sub>{{ detailOf(c) }}</template>
                <template v-if="detailOf(c) || isMod" #trailing>
                  <span v-if="detailOf(c)" class="hidden sm:inline text-xs tabular-nums text-zinc-400">{{ detailOf(c) }}</span>
                  <button
                    v-if="isMod"
                    type="button"
                    class="w-6 h-6 rounded text-zinc-500 hover:text-red-300 hover:bg-zinc-800 sm:opacity-0 group-hover/change:opacity-100 focus-visible:opacity-100"
                    title="Remove this entry"
                    aria-label="Remove this entry"
                    @click.prevent.stop="deleteChange(c)"
                  >×</button>
                </template>
              </LevelRow>
            </li>
          </ul>
          <button
            v-if="s.hidden"
            type="button"
            class="w-full px-4 pb-3 pt-1 text-left text-xs text-zinc-400 hover:text-accent"
            @click="openSection(s.key)"
          >Show {{ n(s.hidden) }} more {{ SECTION_LABEL[s.kind].toLowerCase() }}</button>
        </div>
      </section>

      <p v-if="!pending && totalShown === 0" class="py-16 text-center text-sm text-zinc-500">
        Nothing matches.
      </p>
    </div>

    <div ref="moreEl" class="py-6 text-center">
      <button v-if="hasMore" type="button" class="btn btn-sm btn-ghost" @click="drawMore">
        Show more days
      </button>
    </div>
  </div>
</template>

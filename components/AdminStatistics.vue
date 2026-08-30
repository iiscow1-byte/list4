<script setup lang="ts">
/**
 * Traffic and growth, side by side.
 *
 * Two questions that only mean something together: how much is the site being
 * read, and how much is being added to it. A spike in visits the week a hundred
 * levels were submitted is a different fact from the same spike in a quiet week.
 *
 * **Views and people are kept apart everywhere.** They were drawn as one bar in
 * front of another, which made both unreadable and invited reading them as one
 * number. They are separate figures, separate axes and separate colours now,
 * because the ratio between them is the interesting part: four thousand views
 * from two hundred people is a site being read, and four thousand from six is
 * somebody's script.
 *
 * Everything is drawn from counts — see `server/utils/analytics.ts`. There is
 * no per-visitor record behind any of it, so there is nothing here to drill
 * into, and the tab is honest about that rather than implying a detail it
 * deliberately doesn't keep.
 */
type Day = { day: string; views: number; visitors: number; accounts: number; logins: number }
type Point = { day: string; n: number }
type Analytics = {
  days: number
  totals: {
    viewsAllTime: number; visitorsAllTime: number
    viewsToday: number; visitorsToday: number; accountsToday: number; loginsToday: number
    views7: number; visitors7: number; views30: number; visitors30: number
    countingSince: string | null
  }
  range: {
    views: number; visitors: number; visitorDays: number; accounts: number; logins: number
    busiestDay: { day: string; views: number } | null
  }
  lifetime: Record<string, number>
  daily: Day[]
  hourly: {
    hour: number
    views: number; people: number
    avgViews: number; avgPeople: number
    todayViews: number; todayPeople: number
  }[]
  hourlyMeta: { viewDays: number; peopleDays: number }
  topPages: { path: string; n: number }[]
  topLevels: { position: number; sheet_placement: number | null; name: string; n: number }[]
  topLevelsAllTime: { position: number; sheet_placement: number | null; name: string; n: number }[]
  topLists: { public_id: string; title: string; n: number; owner: string | null }[]
  topProfiles: { username: string; n: number }[]
  growth: Record<string, Point[]>
}

/**
 * Submitted by a person, or mirrored from another list.
 *
 * Both land in `pending_levels`, and until now the statistics counted them
 * together — so "levels submitted" was mostly a graph of when the importers
 * last ran. Which of the two a row is comes from
 * `server/utils/pending-source.ts`, the same definition the review queue
 * splits its tabs by.
 */

const days = ref(30)
const { data, pending, refresh } = await useFetch<Analytics>('/api/admin/analytics', {
  query: computed(() => ({ days: days.value })),
})

/**
 * `SegmentedControl` speaks plain strings; these are a number and two unions.
 * Converting at the boundary keeps the page's own types honest rather than
 * widening them to suit a component.
 */
const daysModel = computed({
  get: () => String(days.value),
  set: (v: string) => { days.value = Number(v) },
})

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString()

/** `2026-08-04` → `4 Aug`. */
function shortDay(day: string | null | undefined): string {
  if (!day) return '—'
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const COLORS = {
  views: '#f4c430',
  visitors: '#38bdf8',
  accounts: '#a78bfa',
  logins: '#34d399',
}

/**
 * Which lines the traffic chart draws.
 *
 * Views on the left axis, everything counted in *people* on the right — they
 * differ by an order of magnitude, and on a shared axis the people line is a
 * flat smear along the bottom.
 */
const trafficSeries = ref<Record<'views' | 'visitors' | 'accounts' | 'logins', boolean>>({
  views: true, visitors: true, accounts: true, logins: false,
})
const TRAFFIC_DEFS = [
  { key: 'views', label: 'Page views', color: COLORS.views, axis: 'left' as const, kind: 'area' as const },
  { key: 'visitors', label: 'Unique visitors', color: COLORS.visitors, axis: 'right' as const, kind: 'line' as const },
  { key: 'accounts', label: 'Signed-in accounts', color: COLORS.accounts, axis: 'right' as const, kind: 'line' as const },
  { key: 'logins', label: 'Fresh logins', color: COLORS.logins, axis: 'right' as const, kind: 'line' as const },
]
const shownTraffic = computed(() =>
  TRAFFIC_DEFS.filter((s) => trafficSeries.value[s.key as keyof typeof trafficSeries.value]),
)

/** Which growth series the second chart draws. */
const GROWTH_SERIES = [
  { key: 'accounts', label: 'Accounts created', color: '#60a5fa' },
  // Submissions and imports are separate series. They share a table, and an
  // importer arrives in the thousands — one mirror refresh buried every real
  // submission the site had ever had under a single day's bar.
  { key: 'levelsSubmitted', label: 'Levels submitted', color: '#f4c430' },
  { key: 'levelsImported', label: 'Levels imported', color: '#94a3b8' },
  { key: 'records', label: 'Records submitted', color: '#34d399' },
  { key: 'customLists', label: 'Lists created', color: '#f472b6' },
  { key: 'comments', label: 'Comments', color: '#a78bfa' },
  { key: 'opinions', label: 'Opinions', color: '#fb923c' },
] as const
const growthKey = ref<(typeof GROWTH_SERIES)[number]['key']>('accounts')
const growthDef = computed(() => GROWTH_SERIES.find((s) => s.key === growthKey.value)!)
const growthPoints = computed<Point[]>(() => data.value?.growth?.[growthKey.value] ?? [])
const growthTotal = computed(() => growthPoints.value.reduce((s, p) => s + p.n, 0))
const growthChartSeries = computed(() => [
  { key: 'n', label: growthDef.value.label, color: growthDef.value.color, axis: 'left' as const, kind: 'area' as const },
])

/**
 * The shape of a day.
 *
 * Averages rather than raw totals, because a 90-day range would otherwise make
 * every bar ninety times taller than the same chart at 7 days while saying
 * nothing more. An average is comparable across ranges — and it is divided by
 * the days that actually carry data, not by the window, so a range reaching
 * back before counting started doesn't report an average of half of nothing.
 *
 * Two series, like everywhere else on this tab: views are bars, people are a
 * line on the right axis. One reader working through forty pages between nine
 * and ten is forty views and one person, and which of those a busy hour is made
 * of is the whole reason to look at it.
 */
type HourMode = 'average' | 'today'
const hourMode = ref<HourMode>('average')
const hourModel = computed({
  get: () => hourMode.value as string,
  set: (v: string) => { hourMode.value = v as HourMode },
})
/** `14` → `14:00`. UTC, like everything else that is counted. */
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
const hourX = (v: string | number) => hourLabel(Number(v))

const hourSeries = computed(() =>
  hourMode.value === 'today'
    ? [
        { key: 'todayViews', label: 'Page views', color: COLORS.views, axis: 'left' as const, kind: 'bar' as const },
        // The typical day, behind today, so "is this busy?" has an answer on
        // the same axis rather than in another chart.
        { key: 'avgViews', label: 'Average day', color: '#71717a', axis: 'left' as const, kind: 'line' as const, dashed: true },
        { key: 'todayPeople', label: 'People', color: COLORS.visitors, axis: 'right' as const, kind: 'line' as const },
      ]
    : [
        { key: 'avgViews', label: 'Page views', color: COLORS.views, axis: 'left' as const, kind: 'bar' as const },
        { key: 'avgPeople', label: 'People', color: COLORS.visitors, axis: 'right' as const, kind: 'line' as const },
      ],
)

const peakHour = computed(() => {
  let best: { hour: number; value: number } | null = null
  for (const h of data.value?.hourly ?? []) {
    const value = hourMode.value === 'today' ? h.todayViews : h.avgViews
    if (!best || value > best.value) best = { hour: h.hour, value }
  }
  return best && best.value > 0 ? best : null
})
/** What the averages are divided by — an average over one day is not an average. */
const hourBasis = computed(() => {
  const m = data.value?.hourlyMeta
  if (hourMode.value === 'today' || !m) return ''
  return `over ${m.viewDays} day${m.viewDays === 1 ? '' : 's'}`
})

/**
 * The headline. Views and people are separate tiles, never one figure with the
 * other as a footnote.
 */
const headline = computed(() => {
  const t = data.value?.totals
  const r = data.value?.range
  if (!t || !r) return []
  const per = r.visitors > 0 ? (r.views / r.visitors) : 0
  return [
    { label: 'Page views', value: fmt(r.views), hint: `in ${data.value!.days} days`, tone: COLORS.views },
    { label: 'Unique visitors', value: fmt(r.visitors), hint: `${fmt(r.visitorDays)} visitor-days`, tone: COLORS.visitors },
    { label: 'Views per visitor', value: per ? per.toFixed(1) : '—', hint: `in ${data.value!.days} days`, tone: undefined },
    { label: 'Signed-in accounts', value: fmt(r.accounts), hint: `${fmt(r.logins)} fresh logins`, tone: COLORS.accounts },
  ]
})

/** Today and all time, kept out of the headline so no window is ambiguous. */
const secondary = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  return [
    { label: 'Today', a: `${fmt(t.viewsToday)} views`, b: `${fmt(t.visitorsToday)} people · ${fmt(t.accountsToday)} signed in` },
    { label: 'Last 7 days', a: `${fmt(t.views7)} views`, b: `${fmt(t.visitors7)} people` },
    { label: 'Last 30 days', a: `${fmt(t.views30)} views`, b: `${fmt(t.visitors30)} people` },
    {
      label: 'All time',
      a: `${fmt(t.viewsAllTime)} views`,
      b: t.countingSince ? `${fmt(t.visitorsAllTime)} people · since ${shortDay(t.countingSince)}` : 'nothing counted yet',
    },
  ]
})

const LIFETIME_ROWS = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'accountsWithRecords', label: '…with an accepted record' },
  { key: 'accountsBanned', label: '…banned' },
  { key: 'levels', label: 'Levels on the list' },
  { key: 'levelsSubmitted', label: 'Levels submitted' },
  { key: 'levelsSubmittedPending', label: '…still pending' },
  { key: 'levelsImported', label: 'Levels imported' },
  { key: 'levelsImportedPending', label: '…still pending' },
  { key: 'records', label: 'Records submitted' },
  { key: 'recordsAccepted', label: '…accepted' },
  { key: 'recordsPending', label: '…still pending' },
  { key: 'customLists', label: 'Custom lists' },
  { key: 'publicLists', label: '…published' },
  { key: 'clans', label: 'Clans' },
  { key: 'comments', label: 'Comments' },
  { key: 'opinions', label: 'Opinions' },
  { key: 'progressPosts', label: 'Progress posts' },
  { key: 'follows', label: 'Follows' },
  { key: 'levelsViewed', label: 'Levels ever opened' },
  { key: 'listsViewed', label: 'Lists ever opened' },
] as const

/** The most-viewed levels: in the window, or ever. Two different questions. */
const levelScope = ref<'range' | 'all'>('range')
const levelScopeModel = computed({
  get: () => levelScope.value as string,
  set: (v: string) => { levelScope.value = v as 'range' | 'all' },
})
const shownLevels = computed(() =>
  levelScope.value === 'all' ? (data.value?.topLevelsAllTime ?? []) : (data.value?.topLevels ?? []),
)
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="container-wide py-6 space-y-6">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold tracking-tight text-zinc-100">Statistics</h1>
          <p class="text-xs text-zinc-500 mt-0.5 max-w-2xl">
            A <em>view</em> is one page opened; a <em>visitor</em> is one person, counted
            once a day, anonymously. All times are UTC.
          </p>
        </div>
        <div class="flex items-center gap-1">
          <SegmentedControl
            v-model="daysModel"
            aria-label="How far back"
            :options="[
              { value: '7', label: '7d' },
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
              { value: '365', label: '1y' },
            ]"
          />
          <button
            type="button"
            class="btn btn-sm btn-ghost ml-1"
            :disabled="pending"
            @click="refresh()"
          >{{ pending ? '…' : 'Refresh' }}</button>
        </div>
      </header>

      <p v-if="!data" class="text-sm text-zinc-500">Loading…</p>

      <template v-else>
        <!-- Headline: four separate figures, never one blended "traffic" number -->
        <dl class="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
          <div v-for="h in headline" :key="h.label" class="bg-zinc-950 px-4 py-3.5">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
              <span v-if="h.tone" class="w-2 h-2 rounded-sm shrink-0" :style="{ backgroundColor: h.tone }" />
              {{ h.label }}
            </dt>
            <dd class="tabular-nums text-2xl font-bold text-zinc-50 mt-0.5">{{ h.value }}</dd>
            <p class="text-[10px] text-zinc-600 mt-0.5">{{ h.hint }}</p>
          </div>
        </dl>

        <p
          v-if="!data.totals.viewsAllTime"
          class="card px-4 py-6 text-center text-sm text-zinc-500"
        >
          Nothing counted yet. View tracking started with this version of the site.
        </p>

        <!-- Traffic over time -->
        <section class="card p-4">
          <div class="flex items-baseline justify-between gap-3 flex-wrap mb-2">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Traffic
              <span class="ml-2 normal-case tracking-normal text-zinc-600">
                {{ data.days }} days to today
                <template v-if="data.range.busiestDay?.views">
                  · busiest {{ shortDay(data.range.busiestDay.day) }} at {{ fmt(data.range.busiestDay.views) }}
                </template>
              </span>
            </h2>
            <!-- Each line can be turned off, because four at once is a lot and
                 the useful comparison is usually a pair. -->
            <div class="flex items-center gap-1 flex-wrap">
              <button
                v-for="s in TRAFFIC_DEFS"
                :key="s.key"
                type="button"
                class="rounded-lg border px-2 py-0.5 text-[11px] transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                :class="trafficSeries[s.key as keyof typeof trafficSeries]
                  ? 'border-zinc-600 text-zinc-100 bg-zinc-900'
                  : 'border-zinc-800 text-zinc-600 hover:text-zinc-300'"
                @click="trafficSeries[s.key as keyof typeof trafficSeries] = !trafficSeries[s.key as keyof typeof trafficSeries]"
              >
                <span
                  class="w-2 h-2 rounded-sm shrink-0"
                  :style="{ backgroundColor: trafficSeries[s.key as keyof typeof trafficSeries] ? s.color : 'transparent', boxShadow: `inset 0 0 0 1px ${s.color}` }"
                />
                {{ s.label }}
              </button>
            </div>
          </div>
          <TimeChart :points="data.daily" :series="shownTraffic" :height="230" />
        </section>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <!-- When the site is read -->
          <section class="card p-4">
            <div class="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                By hour
                <span class="ml-2 normal-case tracking-normal text-zinc-600">
                  UTC<template v-if="hourBasis"> · averaged {{ hourBasis }}</template>
                  <template v-if="peakHour"> · busiest {{ hourLabel(peakHour.hour) }}</template>
                </span>
              </h2>
              <SegmentedControl
                v-model="hourModel"
                aria-label="Which hours"
                :options="[
                  { value: 'average', label: 'Average day' },
                  { value: 'today', label: 'Today' },
                ]"
              />
            </div>
            <!-- Hours are buckets, not instants: `bar` puts the chart on a band
                 scale, where 09:00 owns the width it represents. -->
            <TimeChart
              :points="data.hourly"
              :series="hourSeries"
              :height="200"
              x-key="hour"
              :x-format="hourX"
              :x-every="4"
              x-unit="hours"
            />
          </section>

          <!-- What was added -->
          <section class="card p-4">
            <div class="flex items-baseline justify-between gap-3 flex-wrap mb-2">
              <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                What was added
                <span class="ml-2 normal-case tracking-normal text-zinc-600 tabular-nums">
                  {{ fmt(growthTotal) }} in {{ data.days }} days
                </span>
              </h2>
            </div>
            <div class="flex items-center gap-1 flex-wrap mb-2">
              <button
                v-for="s in GROWTH_SERIES"
                :key="s.key"
                type="button"
                class="rounded-lg border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                :class="growthKey === s.key
                  ? 'border-zinc-600 text-zinc-100 bg-zinc-900'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'"
                @click="growthKey = s.key"
              >{{ s.label }}</button>
            </div>
            <TimeChart :points="growthPoints" :series="growthChartSeries" :height="170" />
          </section>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <!-- Everything, in total -->
          <section class="card p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">All time</h2>
            <dl class="space-y-1">
              <div
                v-for="row in LIFETIME_ROWS"
                :key="row.key"
                class="flex items-baseline gap-2 text-xs"
                :class="row.label.startsWith('…') ? 'pl-3 text-zinc-600' : 'text-zinc-300'"
              >
                <dt class="flex-1 truncate">{{ row.label }}</dt>
                <dd class="tabular-nums text-zinc-100">{{ fmt(data.lifetime[row.key]) }}</dd>
              </div>
            </dl>
          </section>

          <!-- Where people go -->
          <section class="card p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">
              Most-read pages
              <span class="normal-case tracking-normal text-zinc-600">last {{ data.days }} days</span>
            </h2>
            <p v-if="!data.topPages.length" class="text-xs text-zinc-600">Nothing counted yet.</p>
            <ol v-else class="space-y-1">
              <li v-for="p in data.topPages" :key="p.path" class="flex items-baseline gap-2 text-xs">
                <span class="flex-1 truncate font-mono text-[11px] text-zinc-400">{{ p.path }}</span>
                <span class="tabular-nums text-zinc-200">{{ fmt(p.n) }}</span>
              </li>
            </ol>
          </section>

          <!-- Which levels people open -->
          <section class="card p-4">
            <div class="flex items-baseline justify-between gap-2 mb-2.5">
              <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Most-viewed levels</h2>
              <SegmentedControl
                v-model="levelScopeModel"
                aria-label="Which window"
                :options="[
                  { value: 'range', label: `${data.days}d` },
                  { value: 'all', label: 'All time' },
                ]"
              />
            </div>
            <p v-if="!shownLevels.length" class="text-xs text-zinc-600">Nothing counted yet.</p>
            <ol v-else class="space-y-1">
              <li v-for="l in shownLevels" :key="l.position" class="flex items-baseline gap-2 text-xs">
                <span class="tabular-nums text-zinc-600 w-12 shrink-0">#{{ l.sheet_placement ?? l.position }}</span>
                <NuxtLink :to="`/levels/${l.position}`" class="flex-1 truncate text-zinc-300 hover:text-accent transition-colors">
                  {{ l.name }}
                </NuxtLink>
                <span class="tabular-nums text-zinc-200">{{ fmt(l.n) }}</span>
              </li>
            </ol>
          </section>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <!-- Windows, spelled out, so no figure above is ambiguous -->
          <section class="card p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">By window</h2>
            <dl class="space-y-2">
              <div v-for="s in secondary" :key="s.label">
                <dt class="text-[10px] uppercase tracking-wider text-zinc-500">{{ s.label }}</dt>
                <dd class="text-xs text-zinc-200 tabular-nums">{{ s.a }}</dd>
                <dd class="text-[10px] text-zinc-600 tabular-nums">{{ s.b }}</dd>
              </div>
            </dl>
          </section>

          <section class="card p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">
              Most-viewed lists
              <span class="normal-case tracking-normal text-zinc-600">all time</span>
            </h2>
            <p v-if="!data.topLists.length" class="text-xs text-zinc-600">No list has been opened yet.</p>
            <ol v-else class="space-y-1">
              <li v-for="l in data.topLists" :key="l.public_id" class="flex items-baseline gap-2 text-xs">
                <NuxtLink :to="`/lists/${l.public_id}`" class="flex-1 truncate text-zinc-300 hover:text-accent transition-colors">
                  {{ l.title }}
                </NuxtLink>
                <span v-if="l.owner" class="text-[10px] text-zinc-600 truncate max-w-[6rem]">{{ l.owner }}</span>
                <span class="tabular-nums text-zinc-200">{{ fmt(l.n) }}</span>
              </li>
            </ol>
          </section>

          <section class="card p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">
              Most-viewed profiles
              <span class="normal-case tracking-normal text-zinc-600">all time</span>
            </h2>
            <p v-if="!data.topProfiles.length" class="text-xs text-zinc-600">No profile has been opened yet.</p>
            <ol v-else class="space-y-1">
              <li v-for="p in data.topProfiles" :key="p.username" class="flex items-baseline gap-2 text-xs">
                <NuxtLink :to="`/users/${encodeURIComponent(p.username)}`" class="flex-1 truncate text-zinc-300 hover:text-accent transition-colors">
                  {{ p.username }}
                </NuxtLink>
                <span class="tabular-nums text-zinc-200">{{ fmt(p.n) }}</span>
              </li>
            </ol>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

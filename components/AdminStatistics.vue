<script setup lang="ts">
/**
 * Traffic and growth, side by side.
 *
 * Two questions that only mean something together: how much is the site being
 * read, and how much is being added to it. A spike in visits the week a hundred
 * levels were submitted is a different fact from the same spike in a quiet week.
 *
 * Everything is drawn from counts — see `server/utils/analytics.ts`. There is
 * no per-visitor record behind any of it, so there is nothing here to drill
 * into, and the tab is honest about that rather than implying a detail it
 * deliberately doesn't keep.
 */
type Point = { day: string; n: number }
type Analytics = {
  days: number
  totals: {
    viewsAllTime: number; viewsToday: number; views7: number; views30: number
    visitorsToday: number; visitors7: number; visitors30: number
    countingSince: string | null
  }
  lifetime: Record<string, number>
  traffic: { views: Point[]; visitors: Point[] }
  topPages: { path: string; n: number }[]
  topLevels: { position: number; sheet_placement: number | null; name: string; n: number; last_viewed_at: string }[]
  growth: Record<string, Point[]>
}

const days = ref(30)
const { data, pending, refresh } = await useFetch<Analytics>('/api/admin/analytics', {
  query: computed(() => ({ days: days.value })),
})

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString()

/** `2026-08-04` → `4 Aug`, for an axis that has to fit thirty of them. */
function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** Which growth series the second chart draws. */
const GROWTH_SERIES = [
  { key: 'accounts', label: 'Accounts created', color: '#60a5fa' },
  { key: 'levelsSubmitted', label: 'Levels submitted', color: '#f4c430' },
  { key: 'records', label: 'Records submitted', color: '#34d399' },
  { key: 'customLists', label: 'Lists created', color: '#f472b6' },
  { key: 'comments', label: 'Comments', color: '#a78bfa' },
  { key: 'opinions', label: 'Opinions', color: '#fb923c' },
] as const
const growthKey = ref<(typeof GROWTH_SERIES)[number]['key']>('accounts')
const growthSeries = computed(() => GROWTH_SERIES.find((s) => s.key === growthKey.value)!)
const growthPoints = computed<Point[]>(() => data.value?.growth?.[growthKey.value] ?? [])
const growthTotal = computed(() => growthPoints.value.reduce((s, p) => s + p.n, 0))

/**
 * Bars, sized against the tallest day in their own series.
 *
 * Relative rather than absolute: the interesting thing about a day is how it
 * compares with the fortnight around it, and an absolute scale would flatten
 * every quiet week into an empty strip.
 */
function bars(points: Point[]) {
  const max = points.reduce((m, p) => Math.max(m, p.n), 0)
  return points.map((p) => ({ ...p, pct: max > 0 ? (p.n / max) * 100 : 0 }))
}
const viewBars = computed(() => bars(data.value?.traffic.views ?? []))
const visitorBars = computed(() => bars(data.value?.traffic.visitors ?? []))
const growthBars = computed(() => bars(growthPoints.value))

const headline = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  return [
    { label: 'Views today', value: fmt(t.viewsToday), hint: `${fmt(t.visitorsToday)} people` },
    { label: 'Views, 7 days', value: fmt(t.views7), hint: `${fmt(t.visitors7)} people` },
    { label: 'Views, 30 days', value: fmt(t.views30), hint: `${fmt(t.visitors30)} people` },
    { label: 'Views, all time', value: fmt(t.viewsAllTime), hint: t.countingSince ? `since ${shortDay(t.countingSince)}` : 'nothing counted yet' },
  ]
})

const LIFETIME_ROWS = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'levels', label: 'Levels on the list' },
  { key: 'levelsSubmitted', label: 'Levels submitted' },
  { key: 'levelsPending', label: '…still pending' },
  { key: 'records', label: 'Records' },
  { key: 'recordsPending', label: '…still pending' },
  { key: 'customLists', label: 'Custom lists' },
  { key: 'publicLists', label: '…published' },
  { key: 'comments', label: 'Comments' },
  { key: 'opinions', label: 'Opinions' },
  { key: 'progressPosts', label: 'Progress posts' },
  { key: 'follows', label: 'Follows' },
] as const
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="container-wide py-6 space-y-6">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold tracking-tight text-zinc-100">Statistics</h1>
          <p class="text-xs text-zinc-500 mt-0.5 max-w-2xl">
            How much the site is read, and how much is added to it. Views are page opens;
            people are counted once a day from a salted hash that can't be turned back into
            anyone — so there is nothing here to drill into, by design.
          </p>
        </div>
        <div class="flex items-center gap-1">
          <button
            v-for="d in [7, 30, 90, 365]"
            :key="d"
            type="button"
            class="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="days === d
              ? 'border-accent/60 text-accent bg-accent/10'
              : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'"
            @click="days = d"
          >{{ d }}d</button>
          <button
            type="button"
            class="ml-1 rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
            :disabled="pending"
            @click="refresh()"
          >{{ pending ? '…' : 'Refresh' }}</button>
        </div>
      </header>

      <p v-if="!data" class="text-sm text-zinc-500">Loading…</p>

      <template v-else>
        <!-- Headline numbers -->
        <dl class="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
          <div v-for="h in headline" :key="h.label" class="bg-zinc-950 px-4 py-3.5">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">{{ h.label }}</dt>
            <dd class="tabular-nums text-2xl font-bold text-zinc-50 mt-0.5">{{ h.value }}</dd>
            <p class="text-[10px] text-zinc-600 mt-0.5">{{ h.hint }}</p>
          </div>
        </dl>

        <p
          v-if="!data.totals.viewsAllTime"
          class="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-6 text-center text-sm text-zinc-500"
        >
          Nothing counted yet. Views start being recorded the first time someone opens a
          page after this version went up.
        </p>

        <!-- Traffic -->
        <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Traffic</h2>
            <div class="flex items-center gap-3 text-[10px]">
              <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-accent" />Views</span>
              <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-sky-400/70" />People</span>
            </div>
          </div>
          <!-- Two bars per day: the taller total behind, people in front. -->
          <div class="flex items-end gap-px h-40">
            <div
              v-for="(b, i) in viewBars"
              :key="b.day"
              class="relative flex-1 h-full flex items-end group"
              :title="`${shortDay(b.day)} — ${fmt(b.n)} views, ${fmt(visitorBars[i]?.n ?? 0)} people`"
            >
              <div class="w-full bg-accent/70 group-hover:bg-accent transition-colors rounded-t-sm" :style="{ height: `${b.pct}%` }" />
              <div
                class="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 bg-sky-400/80 rounded-t-sm"
                :style="{ height: `${visitorBars[i]?.pct ?? 0}%` }"
              />
            </div>
          </div>
          <div class="flex justify-between text-[10px] text-zinc-600 mt-1.5 tabular-nums">
            <span>{{ viewBars.length ? shortDay(viewBars[0]!.day) : '' }}</span>
            <span>{{ viewBars.length ? shortDay(viewBars[viewBars.length - 1]!.day) : '' }}</span>
          </div>
        </section>

        <!-- Growth -->
        <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              What was added
              <span class="ml-2 normal-case tracking-normal text-zinc-600 tabular-nums">
                {{ fmt(growthTotal) }} in {{ data.days }} days
              </span>
            </h2>
            <div class="flex items-center gap-1 flex-wrap">
              <button
                v-for="s in GROWTH_SERIES"
                :key="s.key"
                type="button"
                class="rounded-lg border px-2 py-0.5 text-[11px] transition-colors"
                :class="growthKey === s.key
                  ? 'border-zinc-600 text-zinc-100 bg-zinc-900'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'"
                @click="growthKey = s.key"
              >{{ s.label }}</button>
            </div>
          </div>
          <div class="flex items-end gap-px h-32">
            <div
              v-for="b in growthBars"
              :key="b.day"
              class="flex-1 h-full flex items-end"
              :title="`${shortDay(b.day)} — ${fmt(b.n)} ${growthSeries.label.toLowerCase()}`"
            >
              <div
                class="w-full rounded-t-sm transition-all"
                :style="{ height: `${b.pct}%`, backgroundColor: growthSeries.color }"
              />
            </div>
          </div>
          <div class="flex justify-between text-[10px] text-zinc-600 mt-1.5 tabular-nums">
            <span>{{ growthBars.length ? shortDay(growthBars[0]!.day) : '' }}</span>
            <span>{{ growthBars.length ? shortDay(growthBars[growthBars.length - 1]!.day) : '' }}</span>
          </div>
        </section>

        <div class="grid gap-4 lg:grid-cols-3">
          <!-- Everything, in total -->
          <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
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
          <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
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
          <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">
              Most-viewed levels
              <span class="normal-case tracking-normal text-zinc-600">all time</span>
            </h2>
            <p v-if="!data.topLevels.length" class="text-xs text-zinc-600">Nothing counted yet.</p>
            <ol v-else class="space-y-1">
              <li v-for="l in data.topLevels" :key="l.position" class="flex items-baseline gap-2 text-xs">
                <span class="tabular-nums text-zinc-600 w-12 shrink-0">#{{ l.sheet_placement ?? l.position }}</span>
                <NuxtLink :to="`/levels/${l.position}`" class="flex-1 truncate text-zinc-300 hover:text-accent transition-colors">
                  {{ l.name }}
                </NuxtLink>
                <span class="tabular-nums text-zinc-200">{{ fmt(l.n) }}</span>
              </li>
            </ol>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

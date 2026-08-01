<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { yearColor, difficultyColor, ratingColor } from '~/utils/stat-colors'
import { SITE_VERSION } from '~/utils/site-updates'

/**
 * About &amp; stats.
 *
 * Split into three tabs rather than one long scroll: the prose, the numbers and
 * the source-list index are three different errands, and the distributions in
 * particular were unreadable as a flat grid of coloured boxes — every bucket
 * looked the same size whether it held nine levels or nine thousand. They're
 * charts now, scaled against the largest bucket in their own group.
 */
type Landing = {
  intro: string[]
  faq: string[]
  statsViewerFaq: string[]
  lists: { name: string; href: string | null }[]
}

type Bucket = { name: string; count: number }
type Stats = {
  totalLevels: number
  totalListPoints: number
  siteOnlyLevels: number
  totalRecords: number
  totalPlayers: number
  levelsWithRecords: number
  hardest: { position: number; sheet_placement: number | null; name: string; gddl_tier: string; gd_id: number | null } | null
  tiers: { tier: string; count: number }[]
  subtiers: { tier: string; count: number }[]
  years: { year: string; count: number }[]
  difficulties: Bucket[]
  ratings: Bucket[]
  skillsets: Bucket[]
}

const { data: landing } = await useFetch<Landing>('/api/landing')
const { data: stats } = await useFetch<Stats>('/api/stats')

type Tab = 'about' | 'stats' | 'sources'
const route = useRoute()
const router = useRouter()
const TABS: { id: Tab; label: string }[] = [
  { id: 'about',   label: 'About' },
  { id: 'stats',   label: 'Stats' },
  { id: 'sources', label: 'Lists used' },
]
const tab = ref<Tab>(
  TABS.some((t) => t.id === route.query.tab) ? (route.query.tab as Tab) : 'about',
)
watch(tab, (v) => router.replace({ query: { ...route.query, tab: v === 'about' ? undefined : v } }))

const listsSearch = ref('')
const filteredLists = computed(() => {
  const q = listsSearch.value.trim().toLowerCase()
  if (!q) return landing.value?.lists ?? []
  return (landing.value?.lists ?? []).filter((l) => l.name.toLowerCase().includes(q))
})

useHead({ title: 'About & stats — The All Levels List' })

const URL_RE = /(https?:\/\/[^\s]+)/g

/** Split a paragraph that may contain a trailing URL into text + link parts. */
function paraParts(p: string): { text: string; href: string | null } {
  const m = p.match(URL_RE)
  if (!m || m.length === 0) return { text: p, href: null }
  const href = m[m.length - 1]!
  const idx = p.lastIndexOf(href)
  return { text: p.slice(0, idx).trim(), href }
}

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

/** Headline tiles at the top of the Stats tab. */
const headline = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: 'Levels ranked', value: fmt(s.totalLevels), hint: 'Every level with a placement' },
    { label: 'List points', value: fmt(s.totalListPoints), hint: 'Sum of every level\'s point value' },
    { label: 'Records', value: fmt(s.totalRecords), hint: 'Approved completions on the site' },
    { label: 'Players', value: fmt(s.totalPlayers), hint: 'People with at least one approved record' },
  ]
})

/** Subtier 0–5 then Tier 1–39, in one ordinal run — the list's real difficulty axis. */
const tierBuckets = computed(() => [...(stats.value?.subtiers ?? []), ...(stats.value?.tiers ?? [])])
const tierMax = computed(() => Math.max(1, ...tierBuckets.value.map((t) => t.count)))
const yearMax = computed(() => Math.max(1, ...(stats.value?.years ?? []).map((y) => y.count)))

/** Bar width as a percentage of the biggest bucket in the same group. */
function pct(count: number, max: number) {
  return `${Math.max(count > 0 ? 2 : 0, (count / max) * 100)}%`
}

const coveragePct = computed(() => {
  const s = stats.value
  if (!s || !s.totalLevels) return 0
  return (s.levelsWithRecords / s.totalLevels) * 100
})
</script>

<template>
  <div>
    <!-- Hero -->
    <header class="relative overflow-hidden border-b border-zinc-800/80">
      <div
        class="absolute inset-0 bg-[radial-gradient(75%_130%_at_50%_0%,theme(colors.zinc.800),theme(colors.zinc.950))]"
        aria-hidden="true"
      />
      <div class="container-tight relative py-10 space-y-4">
        <div class="flex flex-wrap items-center gap-2.5">
          <h1 class="text-3xl sm:text-4xl font-bold tracking-tight">The All Levels List</h1>
          <span class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            Alpha
          </span>
          <NuxtLink
            to="/updates"
            class="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] tabular-nums text-zinc-400 hover:border-accent/50 hover:text-accent transition-colors"
          >v{{ SITE_VERSION }}</NuxtLink>
        </div>

        <div v-if="landing" class="space-y-2 text-zinc-300 leading-relaxed max-w-3xl">
          <p v-for="(p, i) in landing.intro" :key="`i-${i}`">{{ p }}</p>
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          <NuxtLink
            to="/levels/1"
            class="inline-flex items-center gap-1.5 rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent/90 transition-colors"
          >Browse the list →</NuxtLink>
          <NuxtLink
            to="/levels/submit"
            class="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 text-accent bg-accent/5 font-medium text-sm px-4 py-2 hover:bg-accent/15 transition-colors"
          >Submit a level +</NuxtLink>
          <NuxtLink
            to="/records/submit"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 text-zinc-300 font-medium text-sm px-4 py-2 hover:bg-zinc-900 hover:border-zinc-600 transition-colors"
          >Submit a record +</NuxtLink>
          <NuxtLink
            to="/changelog"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 text-zinc-300 font-medium text-sm px-4 py-2 hover:bg-zinc-900 hover:border-zinc-600 transition-colors"
          >Changelog</NuxtLink>
          <a
            href="https://docs.google.com/spreadsheets/d/1ZRsTUeX4XRCLMcMbyacbk5dkZv8lild8F0zZNs6DGn4"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 text-zinc-300 font-medium text-sm px-4 py-2 hover:bg-zinc-900 hover:border-zinc-600 transition-colors"
          >Legacy ALL ↗</a>
        </div>
      </div>

      <!-- Tabs -->
      <div class="container-tight relative">
        <nav class="flex gap-1 -mb-px" aria-label="About sections">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            :class="tab === t.id
              ? 'border-accent text-accent'
              : 'border-transparent text-zinc-500 hover:text-zinc-200'"
            :aria-current="tab === t.id ? 'page' : undefined"
            @click="tab = t.id"
          >{{ t.label }}</button>
        </nav>
      </div>
    </header>

    <!-- ---------------- About ---------------- -->
    <div v-if="tab === 'about'" class="container-tight py-8 space-y-8 max-w-3xl">
      <section v-if="landing?.faq?.length" class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">How the list works</h2>
        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-900">
          <p v-for="(p, i) in landing.faq" :key="`f-${i}`" class="px-4 py-3 text-sm text-zinc-300 leading-relaxed">
            <template v-for="(part, j) in [paraParts(p)]" :key="j">
              <span v-if="part.text">{{ part.text }} </span>
              <a v-if="part.href" :href="part.href" target="_blank" rel="noopener" class="text-accent hover:underline break-all">{{ part.href }}</a>
            </template>
          </p>
        </div>
      </section>

      <section v-if="landing?.statsViewerFaq?.length" class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Stats Viewer</h2>
        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-900">
          <p v-for="(p, i) in landing.statsViewerFaq" :key="`s-${i}`" class="px-4 py-3 text-sm text-zinc-300 leading-relaxed">{{ p }}</p>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Credits</h2>
        <dl class="grid gap-px sm:grid-cols-2 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
          <div class="bg-zinc-950 px-4 py-3">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">List data</dt>
            <dd class="text-sm text-zinc-100 mt-0.5">Cinder</dd>
          </div>
          <div class="bg-zinc-950 px-4 py-3">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Website</dt>
            <dd class="text-sm text-zinc-100 mt-0.5">GERG, cinnamings, Silk, Farm</dd>
          </div>
        </dl>
        <p class="text-[11px] text-zinc-500 leading-relaxed">
          Player completion data powered by
          <a
            href="https://globalstatsviewer.com"
            target="_blank"
            rel="noopener"
            class="text-zinc-400 hover:text-accent underline-offset-2 hover:underline"
          >Global Stats Viewer</a>. Thanks to everyone who submits records, levels and opinions to keep the list current.
        </p>
      </section>
    </div>

    <!-- ---------------- Stats ---------------- -->
    <div v-else-if="tab === 'stats'" class="container-tight py-8 space-y-8">
      <p v-if="!stats" class="text-sm text-zinc-500">Loading stats…</p>

      <template v-else>
        <!-- Headline numbers -->
        <dl class="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
          <div v-for="h in headline" :key="h.label" class="bg-zinc-950 px-4 py-3.5">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">{{ h.label }}</dt>
            <dd class="tabular-nums text-2xl font-bold text-zinc-50 mt-0.5">{{ h.value }}</dd>
            <p class="text-[10px] text-zinc-600 mt-0.5">{{ h.hint }}</p>
          </div>
        </dl>

        <!-- Two things worth calling out that aren't a distribution -->
        <div class="grid gap-3 sm:grid-cols-2">
          <article v-if="stats.hardest" class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 group">
            <LevelThumbBg
              :gd-id="stats.hardest.gd_id"
              res="high"
              img-class="opacity-25 group-hover:opacity-40"
              overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
            />
            <div class="relative p-4">
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Hardest on the list</h2>
              <NuxtLink :to="`/levels/${stats.hardest.position}`" class="mt-1.5 block">
                <span class="text-lg font-bold text-zinc-50 hover:text-accent transition-colors">{{ stats.hardest.name }}</span>
              </NuxtLink>
              <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span class="tabular-nums rounded px-1.5 py-0.5 bg-zinc-900 text-zinc-300 border border-zinc-800">
                  #{{ stats.hardest.sheet_placement ?? stats.hardest.position }}
                </span>
                <span
                  class="tabular-nums rounded px-1.5 py-0.5 font-semibold"
                  :style="{ backgroundColor: tierColor(stats.hardest.gddl_tier), color: textOn(tierColor(stats.hardest.gddl_tier)) }"
                >{{ stats.hardest.gddl_tier }}</span>
              </div>
            </div>
          </article>

          <article class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Record coverage</h2>
            <p class="mt-1.5 text-2xl font-bold tabular-nums text-zinc-50">{{ coveragePct.toFixed(1) }}%</p>
            <div class="mt-2 h-2 rounded-full bg-zinc-900 overflow-hidden">
              <div class="h-full rounded-full bg-accent" :style="{ width: `${coveragePct}%` }" />
            </div>
            <p class="mt-2 text-[11px] text-zinc-500">
              {{ fmt(stats.levelsWithRecords) }} of {{ fmt(stats.totalLevels) }} ranked levels have at least one approved record.
              {{ fmt(stats.siteOnlyLevels) }} level<template v-if="stats.siteOnlyLevels !== 1">s</template>
              here have no matching ID on the sheet.
            </p>
          </article>
        </div>

        <!-- Tier histogram: 45 ordinal buckets, so vertical bars -->
        <section v-if="tierBuckets.length" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Levels per tier</h2>
            <span class="text-[10px] text-zinc-600 tabular-nums">peak {{ fmt(tierMax) }}</span>
          </div>
          <div class="mt-3 overflow-x-auto">
            <div class="flex items-end gap-[3px] h-40 min-w-[36rem]">
              <div
                v-for="t in tierBuckets"
                :key="t.tier"
                class="flex-1 flex flex-col justify-end h-full group"
                :title="`${t.tier} — ${t.count.toLocaleString()} level${t.count === 1 ? '' : 's'}`"
              >
                <div
                  class="rounded-t-sm transition-opacity group-hover:opacity-80"
                  :style="{ height: pct(t.count, tierMax), backgroundColor: t.count ? tierColor(t.tier) : '#27272a' }"
                />
              </div>
            </div>
            <div class="flex gap-[3px] mt-1.5 min-w-[36rem]">
              <div
                v-for="t in tierBuckets"
                :key="`l-${t.tier}`"
                class="flex-1 text-center text-[8px] text-zinc-600 tabular-nums truncate"
              >{{ t.tier.replace('Subtier ', 'S').replace('Tier ', '') }}</div>
            </div>
          </div>
          <p class="text-[10px] text-zinc-600 mt-2">Subtier 0–5 first, then Tier 1 upward. Hover a bar for the exact count.</p>
        </section>

        <!-- Verification year: also ordinal -->
        <section v-if="stats.years.length" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Verified per year</h2>
          <div class="mt-3 overflow-x-auto">
            <div class="flex items-end gap-1.5 h-32 min-w-[24rem]">
              <div
                v-for="y in stats.years"
                :key="y.year"
                class="flex-1 flex flex-col justify-end h-full group"
                :title="`${y.year} — ${y.count.toLocaleString()} level${y.count === 1 ? '' : 's'}`"
              >
                <span class="text-[9px] text-zinc-500 tabular-nums text-center mb-0.5">{{ fmt(y.count) }}</span>
                <div
                  class="rounded-t transition-opacity group-hover:opacity-80"
                  :style="{ height: pct(y.count, yearMax), backgroundColor: yearColor(y.year) }"
                />
              </div>
            </div>
            <div class="flex gap-1.5 mt-1.5 min-w-[24rem]">
              <div v-for="y in stats.years" :key="`ly-${y.year}`" class="flex-1 text-center text-[9px] text-zinc-600 tabular-nums">{{ y.year }}</div>
            </div>
          </div>
        </section>

        <!-- Nominal breakdowns: few buckets, so horizontal bars with names -->
        <div class="grid gap-4 lg:grid-cols-2">
          <section v-if="stats.difficulties.length" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-3">Difficulty</h2>
            <ul class="space-y-1.5">
              <li v-for="d in stats.difficulties" :key="d.name" class="grid grid-cols-[7.5rem_minmax(0,1fr)_4rem] items-center gap-2">
                <span class="text-[11px] text-zinc-400 truncate">{{ d.name }}</span>
                <span class="h-3 rounded bg-zinc-900 overflow-hidden">
                  <span
                    class="block h-full rounded"
                    :style="{ width: pct(d.count, Math.max(...stats.difficulties.map(x => x.count))), backgroundColor: difficultyColor(d.name) }"
                  />
                </span>
                <span class="text-[11px] text-zinc-500 tabular-nums text-right">{{ fmt(d.count) }}</span>
              </li>
            </ul>
          </section>

          <section v-if="stats.ratings.length" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-3">Rating</h2>
            <ul class="space-y-1.5">
              <li v-for="r in stats.ratings" :key="r.name" class="grid grid-cols-[7.5rem_minmax(0,1fr)_4rem] items-center gap-2">
                <span class="text-[11px] text-zinc-400 truncate">{{ r.name }}</span>
                <span class="h-3 rounded bg-zinc-900 overflow-hidden">
                  <span
                    class="block h-full rounded"
                    :style="{ width: pct(r.count, Math.max(...stats.ratings.map(x => x.count))), backgroundColor: ratingColor(r.name) }"
                  />
                </span>
                <span class="text-[11px] text-zinc-500 tabular-nums text-right">{{ fmt(r.count) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <section v-if="stats.skillsets.length" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-3">Main skillset</h2>
          <ul class="grid gap-1.5 sm:grid-cols-2">
            <li v-for="s in stats.skillsets" :key="s.name" class="grid grid-cols-[7.5rem_minmax(0,1fr)_4rem] items-center gap-2">
              <span class="text-[11px] text-zinc-400 truncate" :title="s.name">{{ s.name }}</span>
              <span class="h-3 rounded bg-zinc-900 overflow-hidden">
                <span class="block h-full rounded bg-accent/70" :style="{ width: pct(s.count, Math.max(...stats.skillsets.map(x => x.count))) }" />
              </span>
              <span class="text-[11px] text-zinc-500 tabular-nums text-right">{{ fmt(s.count) }}</span>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <!-- ---------------- Lists used ---------------- -->
    <div v-else class="container-tight py-8 space-y-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div>
          <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">All demonlists used</h2>
          <p class="text-[11px] text-zinc-500 mt-1">
            Every list the ALL draws placements from.
            <span v-if="landing?.lists?.length" class="tabular-nums text-zinc-600">{{ landing.lists.length }} total.</span>
          </p>
        </div>
        <input
          v-model="listsSearch"
          type="search"
          placeholder="Search lists…"
          class="ml-auto rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <p v-if="filteredLists.length === 0" class="text-sm text-zinc-500 py-8 text-center">No matching lists.</p>
      <ul v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-800 rounded-xl overflow-hidden border border-zinc-800">
        <li v-for="(l, i) in filteredLists" :key="`l-${i}`" class="bg-zinc-950">
          <a
            v-if="l.href"
            :href="l.href"
            target="_blank"
            rel="noopener"
            class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-zinc-200 hover:text-accent hover:bg-zinc-900/70 transition-colors group"
          >
            <span class="truncate">{{ l.name }}</span>
            <span class="text-zinc-600 group-hover:text-accent text-xs shrink-0">↗</span>
          </a>
          <span v-else class="block px-3 py-2.5 text-sm text-zinc-500">{{ l.name }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

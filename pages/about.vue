<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { yearColor, difficultyColor, ratingColor } from '~/utils/stat-colors'
import { SITE_VERSION } from '~/utils/site-updates'
import { ALL_SHEET_URL } from '~/utils/sheet'
// Out of the page so they can be checked without a browser — see `utils/prose.ts`.
import { faqParts, linkLabel } from '~/utils/prose'

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
  totalVisits: number
  visitsSince: string | null
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

/**
 * Every list the ALL draws from.
 *
 * Two sources, merged: the lists this site actually imports (generated from the
 * importer catalogue, so it can't fall behind) and the names the sheet's own
 * "All Demonlists Used" section carries. The sheet names many lists nobody
 * mirrors — those still belong here — but the ones the site pulls live are the
 * ones with a number next to them, and they used to be missing entirely unless
 * the sheet happened to mention them too.
 */
type ImportedSource = {
  key: string; label: string; hint: string; url: string | null
  levels: number; shared: number | null; updated: string | null
}
const { data: sourceData } = await useFetch<{ sources: ImportedSource[] }>('/api/list-sources')

const importedSources = computed(() => sourceData.value?.sources ?? [])

/** Sheet-named lists the site doesn't import, deduped against the ones it does. */
const otherLists = computed(() => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const known = new Set<string>()
  for (const s of importedSources.value) {
    known.add(norm(s.label))
    // "CCL — Consistency Challenge List" should also match a sheet entry of
    // either "CCL" or "Consistency Challenge List".
    for (const part of s.label.split(' — ')) known.add(norm(part))
  }
  return (landing.value?.lists ?? []).filter((l) => !known.has(norm(l.name)))
})

const listsSearch = ref('')
function matches(text: string): boolean {
  const q = listsSearch.value.trim().toLowerCase()
  return !q || text.toLowerCase().includes(q)
}

/**
 * How the mirrored lists are ordered.
 *
 * Catalogue order is the order the site happens to define them in, which is
 * meaningless to a reader. Size answers "which of these is big", overlap
 * answers "how much of it does the ALL already have", and freshness answers
 * the question the page could not answer at all until now — whether what you
 * are reading is current. The ALL sheet is pinned first under every order:
 * it is what the others are being compared *to*.
 */
type ListSort = 'catalogue' | 'levels' | 'overlap' | 'updated'
const LIST_SORTS: { id: ListSort; label: string }[] = [
  { id: 'catalogue', label: 'Default' },
  { id: 'levels', label: 'Size' },
  { id: 'overlap', label: 'Overlap' },
  { id: 'updated', label: 'Freshest' },
]
const listSort = ref<ListSort>('catalogue')

const shownImported = computed(() => {
  const rows = importedSources.value.filter((s) => matches(s.label))
  if (listSort.value === 'catalogue') return rows
  const rank = (s: ImportedSource) => {
    if (listSort.value === 'levels') return s.levels
    if (listSort.value === 'overlap') return sharedPct(s)
    return s.updated ? Date.parse(s.updated.replace(' ', 'T') + 'Z') || 0 : 0
  }
  return [...rows].sort((a, b) => {
    if (a.key === 'all') return -1
    if (b.key === 'all') return 1
    return rank(b) - rank(a)
  })
})
const shownOther = computed(() => otherLists.value.filter((l) => matches(l.name)))
const totalLists = computed(() => importedSources.value.length + otherLists.value.length)

/**
 * Every label is "CCL — Consistency Challenge List". Split rather than printed
 * whole: the short name becomes a fixed-width tag so the column of names starts
 * in the same place on every row, which one run-on string can't do.
 */
function shortName(label: string): string {
  return label.split(' — ')[0]!.trim()
}
function longName(label: string): string {
  const parts = label.split(' — ')
  return parts.length > 1 ? parts.slice(1).join(' — ').trim() : parts[0]!.trim()
}

/** How much of a list the ALL already carries, 0–100. */
function sharedPct(s: ImportedSource): number {
  if (!s.levels || s.shared == null) return 0
  return Math.max(0, Math.min(100, Math.round((s.shared / s.levels) * 100)))
}

/** Levels across every list this site mirrors, the ALL included. */
const indexedLevels = computed(() =>
  importedSources.value.reduce((sum, s) => sum + (s.levels || 0), 0),
)

/**
 * "3h ago" for a mirror's last refresh.
 *
 * Relative rather than a timestamp: what a reader wants from this column is
 * "is this current", and "4 August, 02:15" makes them work that out. Anything
 * older than a week gets the date instead, where the relative form stops
 * being easier to read than the thing it replaced.
 */
function freshness(at: string | null): string | null {
  if (!at) return null
  const t = Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z')
  if (Number.isNaN(t)) return null
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days}d ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** How stale is too stale to look routine. Importers run daily. */
function isStale(at: string | null): boolean {
  if (!at) return false
  const t = Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z')
  return !Number.isNaN(t) && Date.now() - t > 7 * 24 * 60 * 60 * 1000
}


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

/**
 * The four numbers worth knowing before reading anything.
 *
 * The About tab had no numbers at all: you had to know there was a Stats tab,
 * and go to it, to learn whether this list has fifty levels or fifty thousand —
 * which is the first thing anybody wants from a page called About.
 */
const glance = computed(() => {
  const st = stats.value
  if (!st) return []
  return [
    { label: 'Levels', value: fmt(st.totalLevels) },
    { label: 'Records', value: fmt(st.totalRecords) },
    { label: 'Players', value: fmt(st.totalPlayers) },
    { label: 'Lists mirrored', value: fmt(importedSources.value.length || null) },
  ]
})

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

/** Headline tiles at the top of the Stats tab. */
/** `2026-08-04` → `4 August 2026`, for the visit counter's "since". */
function longDay(day: string | null | undefined): string | null {
  if (!day) return null
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const headline = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: 'Levels ranked', value: fmt(s.totalLevels), hint: 'Every level with a placement' },
    { label: 'List points', value: fmt(s.totalListPoints), hint: 'Sum of every level\'s point value' },
    { label: 'Records', value: fmt(s.totalRecords), hint: 'Approved completions on the site' },
    { label: 'Players', value: fmt(s.totalPlayers), hint: 'People with at least one approved record' },
    {
      label: 'Pages read',
      value: fmt(s.totalVisits),
      // The date matters as much as the number: counting started long after
      // the site did, and a total with no beginning can't be read.
      hint: longDay(s.visitsSince) ? `Since ${longDay(s.visitsSince)}` : 'Counting from today',
    },
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
            :href="ALL_SHEET_URL"
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
      <!-- The size of the thing, before any prose about it. This page had no
           numbers on it at all: you had to know a Stats tab existed to find out
           whether the list has fifty levels or fifty thousand. -->
      <button
        v-if="glance.length"
        type="button"
        class="w-full text-left group"
        title="Open the stats"
        @click="tab = 'stats'"
      >
        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
          <div v-for="g in glance" :key="g.label" class="bg-zinc-950 px-4 py-3 group-hover:bg-zinc-900/70 transition-colors">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">{{ g.label }}</dt>
            <dd class="tabular-nums text-xl font-bold text-zinc-50 mt-0.5">{{ g.value }}</dd>
          </div>
        </dl>
        <span class="mt-1.5 block text-[11px] text-zinc-600 group-hover:text-accent transition-colors">
          All the numbers →
        </span>
      </button>

      <section v-if="landing?.faq?.length" class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">How the list works</h2>
        <!-- One question per row, with the question as the heading. It was a
             stack of identical grey blocks with the questions buried inside
             them, which is the one shape a FAQ must not have: it is read by
             scanning for a question and stopping. -->
        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-900">
          <div v-for="(p, i) in landing.faq" :key="`f-${i}`" class="px-4 py-3.5">
            <template v-for="(part, j) in [paraParts(p)]" :key="j">
              <template v-for="(qa, k) in [faqParts(part.text)]" :key="k">
                <h3 v-if="qa.question" class="text-sm font-semibold text-zinc-100 leading-snug">{{ qa.question }}</h3>
                <p class="text-sm text-zinc-400 leading-relaxed" :class="qa.question ? 'mt-1' : ''">
                  {{ qa.answer }}
                  <a
                    v-if="part.href"
                    :href="part.href"
                    target="_blank"
                    rel="noopener"
                    :title="part.href"
                    class="text-accent hover:underline whitespace-nowrap"
                  >{{ linkLabel(part.href) }} ↗</a>
                </p>
              </template>
            </template>
          </div>
        </div>
      </section>

      <section v-if="landing?.statsViewerFaq?.length" class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Stats Viewer</h2>
        <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-900">
          <div v-for="(p, i) in landing.statsViewerFaq" :key="`s-${i}`" class="px-4 py-3.5">
            <template v-for="(qa, k) in [faqParts(p)]" :key="k">
              <h3 v-if="qa.question" class="text-sm font-semibold text-zinc-100 leading-snug">{{ qa.question }}</h3>
              <p class="text-sm text-zinc-400 leading-relaxed" :class="qa.question ? 'mt-1' : ''">{{ qa.answer }}</p>
            </template>
          </div>
        </div>
      </section>

      <!-- Where to actually do something. The hero's buttons scroll away, and
           this is the bottom of the page somebody reaches having decided they
           want in. -->
      <section class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Taking part</h2>
        <div class="grid gap-px sm:grid-cols-3 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
          <NuxtLink to="/levels/submit" class="bg-zinc-950 px-4 py-3.5 hover:bg-zinc-900/70 transition-colors group">
            <span class="block text-sm font-semibold text-zinc-100 group-hover:text-accent transition-colors">Submit a level</span>
            <span class="block text-[11px] text-zinc-500 mt-0.5">Something missing? Say roughly where it goes and we'll place it.</span>
          </NuxtLink>
          <NuxtLink to="/records/submit" class="bg-zinc-950 px-4 py-3.5 hover:bg-zinc-900/70 transition-colors group">
            <span class="block text-sm font-semibold text-zinc-100 group-hover:text-accent transition-colors">Submit a record</span>
            <span class="block text-[11px] text-zinc-500 mt-0.5">Your completions, on your profile and on the leaderboard.</span>
          </NuxtLink>
          <NuxtLink to="/clans" class="bg-zinc-950 px-4 py-3.5 hover:bg-zinc-900/70 transition-colors group">
            <span class="block text-sm font-semibold text-zinc-100 group-hover:text-accent transition-colors">Start a clan</span>
            <span class="block text-[11px] text-zinc-500 mt-0.5">Play with people, and be ranked together for it.</span>
          </NuxtLink>
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
          >Global Stats Viewer</a>. Placements are drawn from
          <button type="button" class="text-zinc-400 hover:text-accent underline-offset-2 hover:underline" @click="tab = 'sources'">{{ totalLists }} other demonlists</button>.
          Thanks to everyone who submits records, levels and opinions to keep the list current.
        </p>
      </section>
    </div>

    <!-- ---------------- Stats ---------------- -->
    <div v-else-if="tab === 'stats'" class="container-tight py-8 space-y-8">
      <p v-if="!stats" class="text-sm text-zinc-500">Loading stats…</p>

      <template v-else>
        <!-- Headline numbers -->
        <!-- Five tiles now the visit counter is among them: a five-wide row is
             what keeps them one size rather than leaving a stray on its own. -->
        <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
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
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 620px"
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
    <div v-else class="container-tight py-8 space-y-5">
      <header class="space-y-3">
        <div class="flex items-end gap-3 flex-wrap">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold tracking-tight text-zinc-100">All demonlists used</h2>
            <p class="text-xs text-zinc-500 mt-1 max-w-xl leading-relaxed">
              Every list the ALL draws placements from. The ones this site mirrors carry live
              counts; the rest are credited by the sheet.
            </p>
          </div>
          <input
            v-model="listsSearch"
            type="search"
            placeholder="Search lists…"
            class="ml-auto w-full sm:w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <!-- The page's own numbers, rather than a bare "N total" glued to a
             sentence. Overlap is the interesting one: it says how much of each
             list the ALL already carries. -->
        <dl class="grid grid-cols-3 gap-px bg-zinc-800 rounded-xl overflow-hidden border border-zinc-800">
          <div class="bg-zinc-950 px-3 py-2.5">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Lists</dt>
            <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ totalLists }}</dd>
          </div>
          <div class="bg-zinc-950 px-3 py-2.5">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Mirrored here</dt>
            <dd class="tabular-nums text-lg font-semibold text-accent">{{ importedSources.length }}</dd>
          </div>
          <div class="bg-zinc-950 px-3 py-2.5">
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Levels indexed</dt>
            <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ indexedLevels.toLocaleString() }}</dd>
          </div>
        </dl>
      </header>

      <!-- Imported live. Generated from the importers, so this section is
           complete by construction rather than by anyone remembering. -->
      <section v-if="shownImported.length" class="space-y-2">
        <div class="flex items-baseline gap-2 flex-wrap">
          <h3 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Imported by this site</h3>
          <span class="text-[10px] text-zinc-600">kept in sync automatically</span>
          <!-- Catalogue order means nothing to a reader; these three questions
               are the ones the numbers on each row answer. -->
          <div class="ml-auto flex items-center gap-1">
            <button
              v-for="o in LIST_SORTS"
              :key="o.id"
              type="button"
              class="rounded-lg border px-2 py-0.5 text-[10px] transition-colors"
              :class="listSort === o.id
                ? 'border-accent/60 text-accent bg-accent/10'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'"
              @click="listSort = o.id"
            >{{ o.label }}</button>
          </div>
          <span class="text-[10px] tabular-nums text-zinc-700">{{ shownImported.length }}</span>
        </div>
        <ul class="grid grid-cols-1 lg:grid-cols-2 gap-px bg-zinc-800 rounded-xl overflow-hidden border border-zinc-800">
          <li v-for="s in shownImported" :key="s.key" class="bg-zinc-950">
            <component
              :is="s.url ? 'a' : 'div'"
              v-bind="s.url ? { href: s.url, target: '_blank', rel: 'noopener' } : {}"
              class="flex items-center gap-3 px-3.5 py-3 group h-full"
              :class="s.url ? 'hover:bg-zinc-900/70 transition-colors' : ''"
            >
              <!-- The short name, as a fixed-width tag, so the column of names
                   lines up instead of every row starting at a different place. -->
              <span
                class="shrink-0 w-14 text-center px-1.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors"
                :class="s.key === 'all'
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 group-hover:text-zinc-200'"
              >{{ shortName(s.label) }}</span>

              <span class="min-w-0 flex-1">
                <span
                  class="block truncate text-sm"
                  :class="s.url ? 'text-zinc-200 group-hover:text-accent transition-colors' : 'text-zinc-300'"
                >{{ longName(s.label) }}</span>
                <span class="block truncate text-[10px] text-zinc-600">
                  {{ s.hint }}
                  <!-- The column this page was missing: a count says how much
                       of a list is here, only a date says whether it's now. -->
                  <template v-if="freshness(s.updated)">
                    · <span :class="isStale(s.updated) ? 'text-amber-500/80' : 'text-zinc-500'">
                      updated {{ freshness(s.updated) }}
                    </span>
                  </template>
                </span>
              </span>

              <span v-if="s.levels" class="shrink-0 text-right tabular-nums">
                <span class="block text-[11px] text-zinc-300">{{ s.levels.toLocaleString() }}</span>
                <span class="block text-[10px] text-zinc-600">
                  <template v-if="s.key === 'all'">levels</template>
                  <template v-else-if="s.shared != null">{{ sharedPct(s) }}% shared</template>
                  <template v-else>levels</template>
                </span>
              </span>
              <span v-if="s.url" class="shrink-0 text-zinc-700 group-hover:text-accent text-xs">↗</span>
            </component>

            <!-- How much of this list the ALL already carries, as a bar. Two
                 numbers stacked in a corner didn't say "most of CCL is here
                 and almost none of EDI is" at a glance; this does. -->
            <div
              v-if="s.shared != null && s.levels && s.key !== 'all'"
              class="h-0.5 bg-zinc-900"
              :title="`${s.shared.toLocaleString()} of ${s.levels.toLocaleString()} on the ALL`"
            >
              <div class="h-full bg-accent/50" :style="{ width: `${sharedPct(s)}%` }" />
            </div>
          </li>
        </ul>
      </section>

      <!-- Named on the sheet, not mirrored here. -->
      <section v-if="shownOther.length" class="space-y-2">
        <div class="flex items-baseline gap-2">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Also credited on the sheet</h3>
          <span class="text-[10px] text-zinc-700">not mirrored here</span>
          <span class="ml-auto text-[10px] tabular-nums text-zinc-700">{{ shownOther.length }}</span>
        </div>
        <ul class="flex flex-wrap gap-1.5">
          <li v-for="(l, i) in shownOther" :key="`l-${i}`">
            <a
              v-if="l.href"
              :href="l.href"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-accent hover:border-accent/40 transition-colors"
            >
              {{ l.name }}
              <span class="text-zinc-700 text-[10px]" aria-hidden="true">↗</span>
            </a>
            <span
              v-else
              class="inline-block rounded-lg border border-zinc-900 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-500"
            >{{ l.name }}</span>
          </li>
        </ul>
      </section>

      <p v-if="!shownImported.length && !shownOther.length" class="text-sm text-zinc-500 py-12 text-center">
        No list matches “{{ listsSearch }}”.
      </p>
    </div>
  </div>
</template>

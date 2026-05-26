<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { yearColor, difficultyColor, ratingColor } from '~/utils/stat-colors'

function shortTier(tier: string | null): string | null {
  if (!tier) return null
  // "Tier 12" → "T12", "Subtier 3" → "S3"
  const t = tier.match(/^Tier (\d{1,2})$/)
  if (t) return `${t[1]}`
  const s = tier.match(/^Subtier (\d{1,2})$/)
  if (s) return `S${s[1]}`
  return tier
}

type Landing = {
  intro: string[]
  faq: string[]
  statsViewerFaq: string[]
  lists: { name: string; href: string | null }[]
}

type Stats = {
  totalLevels: number
  totalListPoints: number
  tiers: { tier: string; count: number }[]
  subtiers: { tier: string; count: number }[]
  years: { year: string; count: number }[]
  difficulties: { name: string; count: number }[]
  ratings: { name: string; count: number }[]
}

function box(bg: string) {
  return { backgroundColor: bg, color: textOn(bg) }
}
function mutedOn(bg: string) {
  // Slightly faded label color over the same backdrop — black/white at 70% alpha.
  return textOn(bg) === '#0a0a0a' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.7)'
}

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

const { data: landing } = await useFetch<Landing>('/api/landing')
const { data: stats } = await useFetch<Stats>('/api/stats')
const { data: changes, refresh: refreshChanges } = await useFetch<Changes>('/api/changes/recent', {
  query: { days: 14, limit: 300 },
})

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

const changelogView = ref<'all' | 'challenge'>('all')
const changelogOrder = ref<'placement' | 'recent'>('placement')

function filteredChanges(changes: Change[]) {
  const list = changelogView.value === 'challenge'
    ? changes.filter((c) => c.level_rated === 'Challenge')
    : changes
  if (changelogOrder.value === 'recent') return list
  if (changelogView.value === 'challenge') {
    // Sort hardest-first (lowest challenge rank = hardest)
    return [...list].sort((a, b) => (a.challenge_rank ?? 9999) - (b.challenge_rank ?? 9999))
  }
  return [...list].sort((a, b) => a.to_position - b.to_position)
}

// Total challenge changes across all days (for badge)
const totalChallengeChanges = computed(() =>
  changes.value?.days.reduce((n, d) => n + d.changes.filter((c) => c.level_rated === 'Challenge').length, 0) ?? 0,
)

const listsSearch = ref('')
const filteredLists = computed(() => {
  const q = listsSearch.value.trim().toLowerCase()
  if (!q) return landing.value?.lists ?? []
  return (landing.value?.lists ?? []).filter((l) => l.name.toLowerCase().includes(q))
})

function formatDay(ymd: string): string {
  // Friendly date — "May 3, 2026" — using UTC so the heading matches the
  // grouping logic on the server.
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

useHead({ title: 'The All Levels List' })

const URL_RE = /(https?:\/\/[^\s]+)/g

/** Split a paragraph that may contain a trailing URL into text + link parts. */
function paraParts(p: string): { text: string; href: string | null } {
  const m = p.match(URL_RE)
  if (!m || m.length === 0) return { text: p, href: null }
  const href = m[m.length - 1]!
  const idx = p.lastIndexOf(href)
  const text = p.slice(0, idx).trim()
  return { text, href }
}
</script>

<template>
  <div class="container-tight py-10 space-y-10">
    <!-- Hero / intro -->
    <header class="space-y-3">
      <h1 class="text-3xl sm:text-4xl font-semibold tracking-tight">The All Levels List</h1>
      <div v-if="landing" class="space-y-2 text-zinc-300 leading-relaxed">
        <p v-for="(p, i) in landing.intro" :key="`i-${i}`">{{ p }}</p>
      </div>
      <div class="pt-2 flex flex-wrap gap-2">
        <NuxtLink
          to="/levels/1"
          class="inline-flex items-center gap-1.5 rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-2 hover:bg-accent/90 transition-colors"
        >Browse the list →</NuxtLink>
        <NuxtLink
          to="/records/submit"
          class="inline-flex items-center gap-1.5 rounded border border-zinc-700 text-zinc-300 font-medium text-sm px-4 py-2 hover:bg-zinc-900 hover:border-zinc-600 transition-colors"
        >Submit a record +</NuxtLink>
        <NuxtLink
          to="/levels/submit"
          class="inline-flex items-center gap-1.5 rounded border border-accent/40 text-accent bg-accent/5 font-medium text-sm px-4 py-2 hover:bg-accent/15 transition-colors"
        >Submit a new level +</NuxtLink>
        <a
          href="https://docs.google.com/spreadsheets/d/test"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 rounded border border-zinc-700 text-zinc-300 font-medium text-sm px-4 py-2 hover:bg-zinc-900 hover:border-zinc-600 transition-colors"
        >Legacy ALL ↗</a>
      </div>
    </header>

    <!-- Recent Changes -->
    <details v-if="changes?.days?.length" open class="space-y-3 group">
      <summary class="cursor-pointer select-none flex items-baseline justify-between gap-2 list-none">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold flex items-center gap-2">
          Recent Changes
          <span class="text-zinc-500 text-[10px] normal-case tracking-normal group-open:hidden">click to expand</span>
        </h2>
        <div class="flex items-center gap-2 ml-auto" @click.stop>
          <!-- View: All / Challenges -->
          <div class="inline-flex rounded border border-zinc-800 overflow-hidden">
            <button
              type="button"
              class="px-2 py-0.5 text-[10px] font-medium transition-colors"
              :class="changelogView === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
              title="Show all changes"
              @click="changelogView = 'all'"
            >All</button>
            <button
              type="button"
              class="px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-zinc-800 flex items-center gap-1"
              :class="changelogView === 'challenge' ? 'bg-amber-900/60 text-amber-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
              title="Show challenge-rated levels only"
              @click="changelogView = 'challenge'"
            >Challenges</button>
          </div>
          <!-- Sort: Placement / Recent -->
          <div class="inline-flex rounded border border-zinc-800 overflow-hidden">
            <button
              type="button"
              class="px-2 py-0.5 text-[10px] font-medium transition-colors"
              :class="changelogOrder === 'placement' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
              title="Sort by highest placing level first"
              @click="changelogOrder = 'placement'"
            >Placement</button>
            <button
              type="button"
              class="px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-zinc-800"
              :class="changelogOrder === 'recent' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
              title="Sort by most recently changed"
              @click="changelogOrder = 'recent'"
            >Recent</button>
          </div>
          <span class="text-zinc-500 text-xs">
            <span class="hidden group-open:inline">▾</span>
            <span class="group-open:hidden">▸</span>
          </span>
        </div>
      </summary>
      <div class="space-y-4 pt-3">
        <template v-for="day in changes.days" :key="day.date">
          <div
            v-if="filteredChanges(day.changes).length"
            class="rounded-md border border-zinc-800 bg-zinc-950/60"
          >
            <div class="px-4 py-2 border-b border-zinc-800 flex items-baseline justify-between gap-3">
              <h3 class="text-sm font-medium text-zinc-100">{{ formatDay(day.date) }}</h3>
              <span class="text-[11px] text-zinc-500 tabular-nums">
                {{ filteredChanges(day.changes).length }} change{{ filteredChanges(day.changes).length === 1 ? '' : 's' }}
              </span>
            </div>
            <ul class="divide-y divide-zinc-900/60">
              <li v-for="(c, i) in filteredChanges(day.changes)" :key="`${day.date}-${i}`" class="px-4 py-2 text-sm flex items-center gap-2 group/row">
                <span
                  v-if="c.kind === 'add'"
                  class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-emerald-900/40 text-emerald-300 border border-emerald-800/60"
                  title="Added to the main list"
                >Added</span>
                <span
                  v-else-if="c.from_position != null && c.to_position < c.from_position"
                  class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-900/40 text-sky-300 border border-sky-800/60"
                  title="Moved up"
                >▲ Moved</span>
                <span
                  v-else
                  class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-800/60"
                  title="Moved down"
                >▼ Moved</span>

                <NuxtLink
                  :to="`/levels/${c.level_position}`"
                  class="truncate text-zinc-200 hover:text-accent transition-colors"
                >{{ c.level_name }}</NuxtLink>

                <span
                  v-if="c.level_gddl_tier && changelogView !== 'challenge'"
                  class="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-medium leading-none"
                  :style="{ backgroundColor: tierColor(c.level_gddl_tier), color: textOn(tierColor(c.level_gddl_tier)) }"
                  :title="c.level_gddl_tier"
                >{{ shortTier(c.level_gddl_tier) }}</span>

                <!-- Right-side: challenge rank in challenge view, ALL position otherwise -->
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
                    <template v-if="c.kind === 'add'">#{{ c.to_position }}</template>
                    <template v-else>
                      <span class="text-zinc-500">#{{ c.from_position }}</span>
                      <span class="text-zinc-600 mx-1">→</span>
                      <span class="text-accent">#{{ c.to_position }}</span>
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
        <p v-if="changelogView === 'challenge' && totalChallengeChanges === 0" class="text-sm text-zinc-500">
          No challenge-rated level changes in the last 14 days.
        </p>
      </div>
    </details>

    <!-- FAQ -->
    <section v-if="landing?.faq?.length" class="space-y-3">
      <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">FAQ</h2>
      <div class="space-y-2 text-sm text-zinc-300 leading-relaxed">
        <p v-for="(p, i) in landing.faq" :key="`f-${i}`">
          <template v-for="(part, j) in [paraParts(p)]" :key="j">
            <span v-if="part.text">{{ part.text }} </span>
            <a v-if="part.href" :href="part.href" target="_blank" rel="noopener" class="text-accent hover:underline break-all">{{ part.href }}</a>
          </template>
        </p>
      </div>
    </section>

    <!-- Stats Viewer FAQ -->
    <section v-if="landing?.statsViewerFaq?.length" class="space-y-3">
      <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Stats Viewer FAQ</h2>
      <div class="space-y-2 text-sm text-zinc-300 leading-relaxed">
        <p v-for="(p, i) in landing.statsViewerFaq" :key="`s-${i}`">{{ p }}</p>
      </div>
    </section>

    <!-- Additional Stats -->
    <section v-if="stats" class="space-y-4">
      <div class="flex items-baseline justify-between flex-wrap gap-2">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Additional Stats</h2>
        <span class="text-xs text-zinc-500 tabular-nums">
          {{ stats.totalLevels.toLocaleString() }} levels · {{ stats.totalListPoints.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} total list points
        </span>
      </div>

      <!-- Tiers (subtiers + tiers) -->
      <div v-if="stats.subtiers.length || stats.tiers.length" class="space-y-2">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Tiers</h3>
        <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div
            v-for="t in [...stats.subtiers, ...stats.tiers]"
            :key="t.tier"
            class="px-3 py-2.5"
            :style="t.count > 0 ? box(tierColor(t.tier)) : { backgroundColor: '#09090b', color: '#3f3f46' }"
          >
            <div class="text-[10px] uppercase tracking-wider" :style="t.count > 0 ? { color: mutedOn(tierColor(t.tier)) } : { color: '#3f3f46' }">{{ t.tier }}</div>
            <div v-if="t.count > 0" class="tabular-nums text-sm">{{ t.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>

      <!-- Years -->
      <div v-if="stats.years.length" class="space-y-2">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verification year</h3>
        <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-8 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div v-for="y in stats.years" :key="y.year" class="px-3 py-2.5" :style="box(yearColor(y.year))">
            <div class="text-[10px] uppercase tracking-wider" :style="{ color: mutedOn(yearColor(y.year)) }">{{ y.year }}</div>
            <div class="tabular-nums text-sm">{{ y.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>

      <!-- Difficulties -->
      <div v-if="stats.difficulties.length" class="space-y-2">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div v-for="d in stats.difficulties" :key="d.name" class="px-3 py-2.5" :style="box(difficultyColor(d.name))">
            <div class="text-[10px] uppercase tracking-wider" :style="{ color: mutedOn(difficultyColor(d.name)) }">{{ d.name }}</div>
            <div class="tabular-nums text-sm">{{ d.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>

      <!-- Ratings -->
      <div v-if="stats.ratings.length" class="space-y-2">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Rating</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div v-for="r in stats.ratings" :key="r.name" class="px-3 py-2.5" :style="box(ratingColor(r.name))">
            <div class="text-[10px] uppercase tracking-wider" :style="{ color: mutedOn(ratingColor(r.name)) }">{{ r.name }}</div>
            <div class="tabular-nums text-sm">{{ r.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- All Demonlists Used -->
    <section v-if="landing?.lists?.length" class="space-y-3">
      <div class="flex items-center gap-3 flex-wrap">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">All Demonlists Used</h2>
        <input
          v-model="listsSearch"
          type="search"
          placeholder="Search lists…"
          class="ml-auto rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <p v-if="filteredLists.length === 0" class="text-sm text-zinc-500 py-2">No matching lists.</p>
      <ul v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-800 rounded-md overflow-hidden">
        <li
          v-for="(l, i) in filteredLists"
          :key="`l-${i}`"
          class="bg-zinc-950"
        >
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
          <span
            v-else
            class="block px-3 py-2.5 text-sm text-zinc-500"
          >{{ l.name }}</span>
        </li>
      </ul>
    </section>

    <p class="text-[11px] text-zinc-500 pt-2">
      Player completion data powered by
      <a
        href="https://globalstatsviewer.com"
        target="_blank"
        rel="noopener"
        class="text-zinc-400 hover:text-accent underline-offset-2 hover:underline"
      >Global Stats Viewer</a>.
    </p>
  </div>
</template>

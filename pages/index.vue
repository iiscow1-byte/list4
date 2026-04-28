<script setup lang="ts">
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

const { data: landing } = await useFetch<Landing>('/api/landing')
const { data: stats } = await useFetch<Stats>('/api/stats')

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
      <div class="pt-2">
        <NuxtLink
          to="/levels/1"
          class="inline-flex items-center gap-1.5 rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-2 hover:bg-accent/90 transition-colors"
        >Browse the list →</NuxtLink>
      </div>
    </header>

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
            class="bg-zinc-950 px-3 py-2.5"
          >
            <div class="text-[10px] uppercase tracking-wider text-zinc-500">{{ t.tier }}</div>
            <div class="tabular-nums text-sm text-zinc-100">{{ t.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>

      <!-- Years -->
      <div v-if="stats.years.length" class="space-y-2">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verification year</h3>
        <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-8 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div v-for="y in stats.years" :key="y.year" class="bg-zinc-950 px-3 py-2.5">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500">{{ y.year }}</div>
            <div class="tabular-nums text-sm text-zinc-100">{{ y.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>

      <!-- Difficulties -->
      <div v-if="stats.difficulties.length" class="space-y-2">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div v-for="d in stats.difficulties" :key="d.name" class="bg-zinc-950 px-3 py-2.5">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500">{{ d.name }}</div>
            <div class="tabular-nums text-sm text-zinc-100">{{ d.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>

      <!-- Ratings -->
      <div v-if="stats.ratings.length" class="space-y-2">
        <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Rating</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div v-for="r in stats.ratings" :key="r.name" class="bg-zinc-950 px-3 py-2.5">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500">{{ r.name }}</div>
            <div class="tabular-nums text-sm text-zinc-100">{{ r.count.toLocaleString() }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- All Demonlists Used -->
    <section v-if="landing?.lists?.length" class="space-y-3">
      <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">All Demonlists Used</h2>
      <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-800 rounded-md overflow-hidden">
        <li
          v-for="(l, i) in landing.lists"
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
  </div>
</template>

<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type Stats = {
  totalLevels: number
  totalListPoints: number
  tiers: { tier: string; count: number }[]
  subtiers: { tier: string; count: number }[]
  years: { year: string; count: number }[]
  difficulties: { name: string; count: number }[]
  ratings: { name: string; count: number }[]
}
type Change = {
  kind: 'add' | 'move'
  level_id: number
  level_position: number
  level_name: string
  level_gddl_tier: string | null
  from_position: number | null
  to_position: number
  changed_at: string
  source: string
}
type Changes = { days: { date: string; changes: Change[] }[] }

const { data: stats } = await useFetch<Stats>('/api/stats')
// All sources — an AREDL-derived move is still a real movement on this list
// once converted, and filtering to native moves would leave the rail empty on
// a fresh deploy. /changelog is where the per-source breakdown lives.
const { data: changes } = await useFetch<Changes>('/api/changes/recent', {
  query: { days: 7, limit: 40 },
})

// Flatten the newest few changes for the "Latest movement" rail.
const recent = computed(() => {
  const out: Change[] = []
  for (const day of changes.value?.days ?? []) {
    for (const c of day.changes) {
      out.push(c)
      if (out.length >= 8) return out
    }
  }
  return out
})

function shortTier(tier: string | null): string | null {
  if (!tier) return null
  const t = tier.match(/^Tier (\d{1,2})$/)
  if (t) return t[1]!
  const s = tier.match(/^Subtier (\d{1,2})$/)
  if (s) return `S${s[1]}`
  return tier
}

useHead({ title: 'The All Levels List' })
</script>

<template>
<<<<<<< HEAD
  <div class="container-wide py-8 space-y-8">
    <!-- Hero -->
    <header class="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-950 px-6 py-8 sm:px-10 sm:py-10">
      <div class="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-accent/10 blur-3xl pointer-events-none" aria-hidden="true" />
      <div class="relative max-w-2xl">
        <p class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-2">All Levels List</p>
        <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50">Build your own list</h1>
        <p class="mt-3 text-sm sm:text-base text-zinc-400 leading-relaxed">
          Drag levels straight out of the ALL list, or add your own. Reorder them however you like,
          then save and share it with a link.
        </p>
        <div class="mt-5 flex flex-wrap gap-2">
          <NuxtLink
            to="/levels/1"
            class="inline-flex items-center gap-1.5 rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent/90 transition-colors"
          >Browse the ALL list →</NuxtLink>
          <NuxtLink
            to="/changelog"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 text-zinc-300 font-medium text-sm px-4 py-2 hover:bg-zinc-900 hover:border-zinc-600 transition-colors"
          >Changelog</NuxtLink>
          <NuxtLink
            to="/about"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 text-zinc-300 font-medium text-sm px-4 py-2 hover:bg-zinc-900 hover:border-zinc-600 transition-colors"
          >About & stats</NuxtLink>
        </div>
        <p v-if="stats" class="mt-4 text-[11px] text-zinc-600 tabular-nums">
          {{ stats.totalLevels.toLocaleString() }} levels ranked
        </p>
=======
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
>>>>>>> 9e17461ac75d4720e14c598c28899e3bffa2d7fb
      </div>
    </header>

    <!-- The builder -->
    <ListBuilder />

    <!-- Latest movement -->
    <section v-if="recent.length" class="space-y-3">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="text-xs uppercase tracking-widest text-accent font-semibold">Latest movement</h2>
        <NuxtLink to="/changelog" class="text-[11px] text-zinc-500 hover:text-accent transition-colors">Full changelog →</NuxtLink>
      </div>
      <ul class="grid gap-1.5 sm:grid-cols-2">
        <li
          v-for="(c, i) in recent"
          :key="`${c.level_id}-${i}`"
          class="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-3 py-2 text-sm"
        >
          <span
            v-if="c.kind === 'add'"
            class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-emerald-950/60 text-emerald-300 border border-emerald-900/60"
          >New</span>
          <span
            v-else-if="c.from_position != null && c.to_position < c.from_position"
            class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-950/60 text-sky-300 border border-sky-900/60"
          >▲</span>
          <span
            v-else
            class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-950/60 text-amber-300 border border-amber-900/60"
          >▼</span>
          <NuxtLink :to="`/levels/${c.level_position}`" class="truncate flex-1 text-zinc-200 hover:text-accent transition-colors">
            {{ c.level_name }}
          </NuxtLink>
          <span
            v-if="c.level_gddl_tier"
            class="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold leading-none"
            :style="{ backgroundColor: tierColor(c.level_gddl_tier), color: textOn(tierColor(c.level_gddl_tier)) }"
          >{{ shortTier(c.level_gddl_tier) }}</span>
          <span
            v-if="c.source === 'aredl'"
            class="shrink-0 text-[9px] uppercase tracking-widest px-1 py-px rounded bg-sky-950/50 text-sky-300/90 border border-sky-900/60"
            title="Converted from AREDL placement history"
          >AREDL</span>
          <span class="shrink-0 tabular-nums text-xs text-zinc-400">#{{ c.to_position }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

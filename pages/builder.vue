<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * The page around the list builder.
 *
 * The builder itself is untouched — everything here is the frame it sits in.
 * That frame used to open with a hero the height of a phone screen, which is
 * why it had a collapse button and why the collapse had to be remembered in
 * localStorage: a heading nobody wants to read twice was sitting on top of the
 * thing the page exists for. A header that is already small needs none of that
 * machinery, so there is none.
 */
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
  to_placement: number | null
  changed_at: string
}
type Changes = { days: { date: string; changes: Change[] }[] }

const { data: stats } = await useFetch<Stats>('/api/stats')
const { data: changes } = await useFetch<Changes>('/api/changes/recent', {
  query: { days: 7, limit: 40 },
})

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

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

/** Which way a change went, as one small labelled chip. */
function movement(c: Change): { label: string; tone: string; title: string } {
  if (c.kind === 'add' || c.from_position == null) {
    return {
      label: 'New',
      tone: 'border-emerald-900/60 bg-emerald-950/60 text-emerald-300',
      title: 'Added to the list',
    }
  }
  const places = Math.abs(c.to_position - c.from_position)
  const up = c.to_position < c.from_position
  return {
    label: `${up ? '▲' : '▼'} ${places.toLocaleString()}`,
    tone: up
      ? 'border-sky-900/60 bg-sky-950/60 text-sky-300'
      : 'border-amber-900/60 bg-amber-950/60 text-amber-300',
    title: `Moved ${up ? 'up' : 'down'} ${places.toLocaleString()} place${places === 1 ? '' : 's'}`,
  }
}

useHead({ title: 'Create your own list — All Levels List' })
</script>

<template>
  <div class="container-wide py-8 space-y-6">
    <!-- One row: what this is, and the two or three places worth going from
         here. Everything it used to say about dragging levels around is said
         better by the builder sitting directly underneath it. -->
    <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div class="min-w-0">
        <p class="text-[10px] uppercase tracking-widest text-accent font-semibold">All Levels List</p>
        <h1 class="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">Create your own list with any level</h1>
        <p class="mt-1 text-sm text-zinc-500 max-w-2xl">
          Pull levels out of the ALL or add your own, order them however you like, then save and
          share it with a link.
          <NuxtLink
            v-if="stats"
            to="/about?tab=stats"
            class="text-zinc-600 hover:text-accent transition-colors tabular-nums"
          >{{ stats.totalLevels.toLocaleString() }} levels to choose from.</NuxtLink>
        </p>
      </div>

      <nav class="flex flex-wrap items-center gap-1.5 shrink-0">
        <NuxtLink
          to="/levels/1"
          class="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-accent/60 hover:text-accent transition-colors"
        >Browse the ALL</NuxtLink>
        <!-- The other shape a list can take. It belongs with the other ways in
             rather than inside the builder's own toolbar, which is for acting
             on the draft you already have. -->
        <NuxtLink
          to="/gdsr"
          class="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-accent/60 hover:text-accent transition-colors"
          title="Sort levels into difficulty tiers instead of ranking them"
        >Create a GDSR <span class="text-[10px] text-zinc-500">(Beta)</span></NuxtLink>
        <NuxtLink
          v-if="me"
          to="/lists?view=mine"
          class="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-accent/60 hover:text-accent transition-colors"
        >My lists</NuxtLink>
        <NuxtLink
          to="/lists"
          class="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-accent/60 hover:text-accent transition-colors"
        >Browse lists</NuxtLink>
      </nav>
    </header>

    <!-- The builder -->
    <ListBuilder />

    <!-- Latest movement -->
    <section v-if="recent.length" class="space-y-2.5">
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
            class="shrink-0 w-14 text-center text-[9px] uppercase tracking-wider tabular-nums px-1.5 py-px rounded border leading-none"
            :class="movement(c).tone"
            :title="movement(c).title"
          >{{ movement(c).label }}</span>
          <NuxtLink :to="`/levels/${c.level_position}`" class="truncate flex-1 text-zinc-200 hover:text-accent transition-colors">
            {{ c.level_name }}
          </NuxtLink>
          <span
            v-if="c.level_gddl_tier"
            class="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold leading-none"
            :style="{ backgroundColor: tierColor(c.level_gddl_tier), color: textOn(tierColor(c.level_gddl_tier)) }"
            :title="c.level_gddl_tier"
          >{{ shortTier(c.level_gddl_tier) }}</span>
          <span class="shrink-0 tabular-nums text-xs text-zinc-400">#{{ c.to_placement ?? c.to_position }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

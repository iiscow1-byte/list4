<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type LevelRow = { position: number; name: string; points: number | null; gddl_tier: string | null }
type CompletedLevel = LevelRow & { percent: number }

defineProps<{
  completed?: CompletedLevel[]
  created?: LevelRow[]
  verified?: LevelRow[]
}>()

function fmt(n: number | null) {
  if (n == null) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toFixed(2)
}
</script>

<template>
  <section v-if="completed" class="rounded-md border border-zinc-800 bg-zinc-950/60">
    <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium px-4 pt-3 pb-2 flex items-baseline gap-2">
      Levels Completed
      <span class="text-[11px] text-zinc-600 normal-case tracking-normal">{{ completed.length }} record{{ completed.length === 1 ? '' : 's' }}</span>
    </h2>
    <div v-if="completed.length === 0" class="px-4 pb-4 text-xs text-zinc-600">No verified records.</div>
    <ul v-else class="divide-y divide-zinc-900">
      <li v-for="l in completed" :key="`c-${l.position}`" class="px-4 py-2 hover:bg-zinc-900/40 transition-colors">
        <NuxtLink :to="`/levels/${l.position}`" class="flex items-center gap-3 group">
          <span
            class="text-[11px] tabular-nums px-2 py-0.5 w-14 shrink-0 text-center font-medium rounded"
            :style="{ backgroundColor: tierColor(l.gddl_tier), color: textOn(tierColor(l.gddl_tier)) }"
          >#{{ l.position }}</span>
          <span class="truncate flex-1 text-sm text-zinc-200 group-hover:text-accent transition-colors">{{ l.name }}</span>
          <span class="ml-auto flex items-center gap-2 shrink-0">
            <span v-if="l.percent < 100" class="tabular-nums text-[11px] text-zinc-500">{{ l.percent }}%</span>
            <span class="tabular-nums text-xs text-amber-300">{{ fmt(l.points) }}</span>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>

  <section v-if="verified" class="rounded-md border border-zinc-800 bg-zinc-950/60 mt-4">
    <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium px-4 pt-3 pb-2 flex items-baseline gap-2">
      Levels Verified
      <span class="text-[11px] text-zinc-600 normal-case tracking-normal">{{ verified.length }} level{{ verified.length === 1 ? '' : 's' }}</span>
    </h2>
    <div v-if="verified.length === 0" class="px-4 pb-4 text-xs text-zinc-600">No verifications credited.</div>
    <ul v-else class="divide-y divide-zinc-900">
      <li v-for="l in verified" :key="`v-${l.position}`" class="px-4 py-2 hover:bg-zinc-900/40 transition-colors">
        <NuxtLink :to="`/levels/${l.position}`" class="flex items-center gap-3 group">
          <span
            class="text-[11px] tabular-nums px-2 py-0.5 w-14 shrink-0 text-center font-medium rounded"
            :style="{ backgroundColor: tierColor(l.gddl_tier), color: textOn(tierColor(l.gddl_tier)) }"
          >#{{ l.position }}</span>
          <span class="truncate text-sm text-zinc-200 group-hover:text-accent transition-colors">{{ l.name }}</span>
          <span class="tabular-nums text-xs text-amber-300 shrink-0 ml-auto">{{ fmt(l.points) }}</span>
        </NuxtLink>
      </li>
    </ul>
  </section>

  <section v-if="created" class="rounded-md border border-zinc-800 bg-zinc-950/60 mt-4">
    <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium px-4 pt-3 pb-2 flex items-baseline gap-2">
      Levels Created
      <span class="text-[11px] text-zinc-600 normal-case tracking-normal">{{ created.length }} level{{ created.length === 1 ? '' : 's' }}</span>
    </h2>
    <div v-if="created.length === 0" class="px-4 pb-4 text-xs text-zinc-600">No levels credited.</div>
    <ul v-else class="divide-y divide-zinc-900">
      <li v-for="l in created" :key="`m-${l.position}`" class="px-4 py-2 hover:bg-zinc-900/40 transition-colors">
        <NuxtLink :to="`/levels/${l.position}`" class="flex items-center gap-3 group">
          <span
            class="text-[11px] tabular-nums px-2 py-0.5 w-14 shrink-0 text-center font-medium rounded"
            :style="{ backgroundColor: tierColor(l.gddl_tier), color: textOn(tierColor(l.gddl_tier)) }"
          >#{{ l.position }}</span>
          <span class="truncate text-sm text-zinc-200 group-hover:text-accent transition-colors">{{ l.name }}</span>
          <span class="tabular-nums text-xs text-amber-300 shrink-0 ml-auto">{{ fmt(l.points) }}</span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

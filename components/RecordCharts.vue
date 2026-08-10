<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type CompletedLevel = {
  position: number
  name: string
  points: number | null
  gddl_tier: string | null
  main_skillset: string | null
  percent: number
  /** 1 for a challenge — decided server-side, see `server/utils/profile.ts`. */
  is_challenge?: number | boolean | null
}

const props = defineProps<{ completed: CompletedLevel[] }>()

/**
 * How much of what someone has beaten is challenges.
 *
 * The two are different games — a challenge is under thirty seconds and a
 * level is not — so "300 completions" says much less than the split does. A
 * ring rather than a pie: with two slices the interesting number is one
 * percentage, and a ring has somewhere to put it.
 */
const CHALLENGE_COLOR = '#f59e0b'
const LEVEL_COLOR = '#60a5fa'

const split = computed(() => {
  const total = props.completed.length
  const challenges = props.completed.reduce((n, l) => n + (l.is_challenge ? 1 : 0), 0)
  const levels = total - challenges
  return {
    total,
    challenges,
    levels,
    challengePct: total ? challenges / total : 0,
    levelPct: total ? levels / total : 0,
  }
})

/**
 * The ring, as one dashed circle over another.
 *
 * Two arcs of a two-slice chart are the same arc drawn from opposite ends, so
 * this is a background ring in one colour and a foreground stroke covering the
 * levels' share of it — no arc maths, and nothing to get wrong at 0 % or 100 %.
 */
const RING_C = 2 * Math.PI * 54
const ringDash = computed(() => `${(split.value.levelPct * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`)

// --- Skillset pie ---
// Stable color order; recycled if there are more skillsets than colors. Picked
// to be visually distinct against the dark zinc background.
const PALETTE = [
  '#f4c430', '#60a5fa', '#34d399', '#f472b6', '#fb923c', '#a78bfa',
  '#22d3ee', '#facc15', '#f87171', '#4ade80', '#c084fc', '#fbbf24',
] as const

const skillsetSlices = computed(() => {
  const counts = new Map<string, number>()
  for (const l of props.completed) {
    const key = l.main_skillset?.trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const total = Array.from(counts.values()).reduce((s, n) => s + n, 0)
  if (total === 0) return { total: 0, slices: [] as { label: string; n: number; pct: number; color: string }[] }
  const slices = Array.from(counts.entries())
    .map(([label, n]) => ({ label, n, pct: n / total, color: '' }))
    .sort((a, b) => b.n - a.n)
  for (let i = 0; i < slices.length; i++) {
    slices[i]!.color = PALETTE[i % PALETTE.length]!
  }
  return { total, slices }
})

const hovered = ref<number | null>(null)

// Top 3 are always shown in the legend; when the user hovers a slice that
// isn't in the top 3, it gets appended as a temporary 4th row so they can
// read its stats without having to chase a tooltip.
const topSlices = computed(() => skillsetSlices.value.slices.slice(0, 3))
const hoveredExtra = computed(() => {
  if (hovered.value == null) return null
  const s = skillsetSlices.value.slices[hovered.value]
  if (!s) return null
  if (topSlices.value.some((t) => t.label === s.label)) return null
  return s
})

// Build SVG arcs for the pie. radius=80, center=(90,90), with a thin gap
// between slices for visual separation when there are many small wedges.
const PIE_R = 80
const PIE_CX = 90
const PIE_CY = 90
const piePaths = computed(() => {
  const slices = skillsetSlices.value.slices
  if (slices.length === 0) return []
  if (slices.length === 1) {
    return [{
      d: `M ${PIE_CX} ${PIE_CY - PIE_R} a ${PIE_R} ${PIE_R} 0 1 1 -0.001 0 z`,
      color: slices[0]!.color,
      label: slices[0]!.label,
      n: slices[0]!.n,
      pct: slices[0]!.pct,
    }]
  }
  const out: { d: string; color: string; label: string; n: number; pct: number }[] = []
  let acc = 0
  for (const s of slices) {
    const start = acc * 2 * Math.PI - Math.PI / 2
    acc += s.pct
    const end = acc * 2 * Math.PI - Math.PI / 2
    const x1 = PIE_CX + PIE_R * Math.cos(start)
    const y1 = PIE_CY + PIE_R * Math.sin(start)
    const x2 = PIE_CX + PIE_R * Math.cos(end)
    const y2 = PIE_CY + PIE_R * Math.sin(end)
    const large = (end - start) > Math.PI ? 1 : 0
    const d = `M ${PIE_CX} ${PIE_CY} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${PIE_R} ${PIE_R} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`
    out.push({ d, color: s.color, label: s.label, n: s.n, pct: s.pct })
  }
  return out
})

// --- Tier bar chart ---
function tierOrd(tier: string | null): number | null {
  if (!tier) return null
  const sub = tier.match(/^Subtier\s+(\d+)$/i)
  if (sub) return Number(sub[1])
  const tier_ = tier.match(/^Tier\s+(\d+)$/i)
  if (tier_) return 5 + Number(tier_[1])
  return null
}

const tierBars = computed(() => {
  const counts = new Map<string, { n: number; ord: number }>()
  for (const l of props.completed) {
    const t = l.gddl_tier?.trim()
    const ord = tierOrd(t ?? null)
    if (!t || ord == null) continue
    const cur = counts.get(t)
    if (cur) cur.n++
    else counts.set(t, { n: 1, ord })
  }
  const list = Array.from(counts.entries())
    .map(([tier, v]) => ({ tier, n: v.n, ord: v.ord }))
    .sort((a, b) => b.ord - a.ord) // hardest first (top of list)
  const max = list.reduce((m, r) => Math.max(m, r.n), 0)
  return { list, max }
})
</script>

<template>
  <div class="space-y-4">
    <!-- Levels vs challenges -->
    <section v-if="split.total" class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2 flex items-baseline gap-2">
        Levels vs challenges
        <span class="text-[10px] text-zinc-600 normal-case tracking-normal">{{ split.total }} beaten</span>
      </h2>
      <!-- Stacked, not side by side.
           The ring and the legend shared a 260px column, which left the labels
           about seventy pixels: "Challenges" rendered as "Ch…", and the word
           being cut was the one the chart is about. The ring is centred on its
           own line now and the legend has the full width under it — the same
           shape the skillset pie below already uses. -->
      <div class="flex flex-col items-center gap-2">
        <svg
          viewBox="0 0 128 128"
          class="w-[104px] h-[104px] shrink-0"
          role="img"
          :aria-label="`${Math.round(split.levelPct * 100)} percent levels, ${Math.round(split.challengePct * 100)} percent challenges`"
        >
          <circle cx="64" cy="64" r="54" fill="none" :stroke="CHALLENGE_COLOR" stroke-width="16" />
          <circle
            cx="64" cy="64" r="54" fill="none"
            :stroke="LEVEL_COLOR"
            stroke-width="16"
            :stroke-dasharray="ringDash"
            transform="rotate(-90 64 64)"
          />
          <text
            x="64" y="60"
            text-anchor="middle"
            class="fill-zinc-100 font-bold"
            style="font-size: 22px"
          >{{ Math.round(split.levelPct * 100) }}%</text>
          <text
            x="64" y="76"
            text-anchor="middle"
            class="fill-zinc-500"
            style="font-size: 9px; letter-spacing: 0.1em"
          >LEVELS</text>
        </svg>

        <ul class="w-full space-y-1">
          <li
            v-for="row in [
              { label: 'Levels', n: split.levels, pct: split.levelPct, color: LEVEL_COLOR },
              { label: 'Challenges', n: split.challenges, pct: split.challengePct, color: CHALLENGE_COLOR },
            ]"
            :key="row.label"
            class="flex items-center gap-2 text-xs px-1"
          >
            <span class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ backgroundColor: row.color }" />
            <span class="flex-1 min-w-0 text-zinc-200">{{ row.label }}</span>
            <span class="tabular-nums text-zinc-500 shrink-0">{{ row.n.toLocaleString() }}</span>
            <span class="tabular-nums text-zinc-600 w-9 text-right shrink-0">{{ Math.round(row.pct * 100) }}%</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- Skillset pie -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2 flex items-baseline gap-2">
        Skillsets
        <span class="text-[10px] text-zinc-600 normal-case tracking-normal">{{ skillsetSlices.total }} record{{ skillsetSlices.total === 1 ? '' : 's' }}</span>
      </h2>
      <div v-if="skillsetSlices.total === 0" class="text-xs text-zinc-600 px-1 py-3 text-center">No records yet.</div>
      <template v-else>
        <svg viewBox="0 0 180 180" class="block w-full max-w-[180px] mx-auto" role="img" aria-label="Skillset distribution">
          <path
            v-for="(p, i) in piePaths" :key="i"
            :d="p.d" :fill="p.color"
            :opacity="hovered == null || hovered === i ? 1 : 0.45"
            stroke="#0a0a0a"
            stroke-width="1"
            class="transition-opacity"
            @mouseenter="hovered = i"
            @mouseleave="hovered = null"
          />
        </svg>
        <ul class="mt-2 space-y-1">
          <li
            v-for="s in topSlices" :key="s.label"
            class="flex items-center gap-2 text-xs px-1 py-0.5 rounded transition-colors"
            :class="hovered != null && skillsetSlices.slices[hovered]?.label === s.label ? 'bg-zinc-900' : ''"
          >
            <span class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ backgroundColor: s.color }" />
            <span class="flex-1 truncate text-zinc-200">{{ s.label }}</span>
            <span class="tabular-nums text-zinc-500">{{ s.n }}</span>
            <span class="tabular-nums text-zinc-600 w-9 text-right">{{ Math.round(s.pct * 100) }}%</span>
          </li>
          <li
            v-if="hoveredExtra"
            :key="`hover-${hoveredExtra.label}`"
            class="flex items-center gap-2 text-xs px-1 py-0.5 rounded bg-zinc-900 border-t border-zinc-800/80"
          >
            <span class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ backgroundColor: hoveredExtra.color }" />
            <span class="flex-1 truncate text-zinc-200">{{ hoveredExtra.label }}</span>
            <span class="tabular-nums text-zinc-500">{{ hoveredExtra.n }}</span>
            <span class="tabular-nums text-zinc-600 w-9 text-right">{{ Math.round(hoveredExtra.pct * 100) }}%</span>
          </li>
        </ul>
      </template>
    </section>

    <!-- Tier bars -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1 pb-2 flex items-baseline gap-2">
        Difficulty tiers
        <span class="text-[10px] text-zinc-600 normal-case tracking-normal">{{ tierBars.list.reduce((s, r) => s + r.n, 0) }} tiered</span>
      </h2>
      <div v-if="tierBars.list.length === 0" class="text-xs text-zinc-600 px-1 py-3 text-center">No tiered records.</div>
      <ul v-else class="space-y-0.5">
        <li v-for="row in tierBars.list" :key="row.tier" class="flex items-center gap-2 text-[11px]">
          <span
            class="px-1.5 py-0.5 w-16 shrink-0 text-center font-medium tabular-nums whitespace-nowrap"
            :style="{ backgroundColor: tierColor(row.tier), color: textOn(tierColor(row.tier)) }"
          >{{ row.tier }}</span>
          <div class="flex-1 h-3.5 bg-zinc-900 rounded-sm overflow-hidden">
            <div
              class="h-full transition-all"
              :style="{
                width: tierBars.max > 0 ? `${(row.n / tierBars.max) * 100}%` : '0%',
                backgroundColor: tierColor(row.tier),
              }"
            />
          </div>
          <span class="tabular-nums text-zinc-400 w-7 text-right">{{ row.n }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

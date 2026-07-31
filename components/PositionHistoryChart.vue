<script setup lang="ts">
/**
 * Placement-over-time step chart. Y axis is inverted (position #1 at the
 * top) so a line falling visually means the level fell down the list.
 *
 * Two optional series:
 *   - `allSeries`   — moves recorded on this site (real ALL placements)
 *   - `aredlSeries` — AREDL's own placements over time
 *
 * Both are real observations. Historical ALL placements converted from AREDL
 * ranks are deliberately excluded — see the note in LevelDetail.
 */
type Point = { at: string; position: number }
const props = defineProps<{
  allSeries: Point[]
  aredlSeries?: Point[]
}>()

const showAredl = ref(true)

const W = 640
const H = 230
const PAD = { top: 14, right: 16, bottom: 26, left: 46 }

function parseT(at: string): number {
  // SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) or ISO — normalize to epoch ms.
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

const series = computed(() => {
  const all = [...props.allSeries]
    .map((p) => ({ t: parseT(p.at), pos: p.position }))
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t)
  const aredl = (showAredl.value ? [...(props.aredlSeries ?? [])] : [])
    .map((p) => ({ t: parseT(p.at), pos: p.position }))
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t)
  return { all, aredl }
})

const hasData = computed(() => series.value.all.length + series.value.aredl.length >= 2)

const domain = computed(() => {
  const pts = [...series.value.all, ...series.value.aredl]
  if (pts.length === 0) return null
  let tMin = Infinity, tMax = -Infinity, pMin = Infinity, pMax = -Infinity
  for (const p of pts) {
    if (p.t < tMin) tMin = p.t
    if (p.t > tMax) tMax = p.t
    if (p.pos < pMin) pMin = p.pos
    if (p.pos > pMax) pMax = p.pos
  }
  // Extend to "now" so the line reaches the right edge.
  const now = Date.now()
  if (now > tMax) tMax = now
  if (tMax === tMin) tMax = tMin + 1
  // Pad the position range slightly so the line doesn't hug the frame.
  const span = Math.max(1, pMax - pMin)
  pMin = Math.max(1, Math.floor(pMin - span * 0.08))
  pMax = Math.ceil(pMax + span * 0.08)
  return { tMin, tMax, pMin, pMax }
})

function x(t: number): number {
  const d = domain.value!
  return PAD.left + ((t - d.tMin) / (d.tMax - d.tMin)) * (W - PAD.left - PAD.right)
}
function y(pos: number): number {
  const d = domain.value!
  // Inverted: smaller position (harder / higher on list) at the top.
  return PAD.top + ((pos - d.pMin) / (d.pMax - d.pMin)) * (H - PAD.top - PAD.bottom)
}

/** Step-after path: hold each position until the next change. */
function stepPath(pts: { t: number; pos: number }[], extendToNow: boolean): string {
  if (pts.length === 0) return ''
  let dStr = `M ${x(pts[0]!.t).toFixed(1)} ${y(pts[0]!.pos).toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    dStr += ` H ${x(pts[i]!.t).toFixed(1)} V ${y(pts[i]!.pos).toFixed(1)}`
  }
  if (extendToNow) dStr += ` H ${x(domain.value!.tMax).toFixed(1)}`
  return dStr
}

// Set the first time the <details> is expanded and never cleared, so
// collapsing and reopening doesn't rebuild the SVG.
const opened = ref(false)
function onToggle(e: Event) {
  if ((e.target as HTMLDetailsElement).open) opened.value = true
}

const allPath = computed(() => (domain.value ? stepPath(series.value.all, true) : ''))
const aredlPath = computed(() => (domain.value ? stepPath(series.value.aredl, true) : ''))

// A level that has absorbed hundreds of passive ±1 shifts would render as a
// solid band of overlapping dots, so only mark vertices on sparse series.
const VERTEX_LIMIT = 60
const allVertices = computed(() => (series.value.all.length <= VERTEX_LIMIT ? series.value.all : []))
const aredlVertices = computed(() => (series.value.aredl.length <= VERTEX_LIMIT ? series.value.aredl : []))

const yTicks = computed(() => {
  const d = domain.value
  if (!d) return []
  const n = 4
  const out: { pos: number; py: number }[] = []
  for (let i = 0; i <= n; i++) {
    const pos = Math.round(d.pMin + ((d.pMax - d.pMin) * i) / n)
    out.push({ pos, py: y(pos) })
  }
  // Dedup rounded collisions on tight ranges.
  return out.filter((t, i, arr) => i === 0 || t.pos !== arr[i - 1]!.pos)
})

const xTicks = computed(() => {
  const d = domain.value
  if (!d) return []
  const n = 4
  const out: { label: string; px: number }[] = []
  for (let i = 0; i <= n; i++) {
    const t = d.tMin + ((d.tMax - d.tMin) * i) / n
    const dt = new Date(t)
    out.push({
      label: dt.toLocaleDateString(undefined, { year: '2-digit', month: 'short' }),
      px: x(t),
    })
  }
  return out
})

// --- Hover tooltip: snap to the nearest vertex of either visible series ---
const hover = ref<{ px: number; py: number; label: string; pos: number; color: string } | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)

function onMove(e: MouseEvent) {
  if (!domain.value || !svgEl.value) return
  const rect = svgEl.value.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * W
  let best: { d2: number; t: number; pos: number; color: string } | null = null
  const consider = (pts: { t: number; pos: number }[], color: string) => {
    for (const p of pts) {
      const dx = x(p.t) - mx
      const d2 = dx * dx
      if (!best || d2 < best.d2) best = { d2, t: p.t, pos: p.pos, color }
    }
  }
  consider(series.value.all, 'rgb(var(--c-accent))')
  consider(series.value.aredl, '#38bdf8')
  if (!best) { hover.value = null; return }
  const b = best as { d2: number; t: number; pos: number; color: string }
  hover.value = {
    px: x(b.t),
    py: y(b.pos),
    label: new Date(b.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    pos: b.pos,
    color: b.color,
  }
}
</script>

<template>
  <details
    v-if="hasData"
    class="group rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden"
    @toggle="onToggle"
  >
    <summary class="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 list-none hover:bg-zinc-900/40 transition-colors">
      <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Placement over time</h3>
      <div class="flex items-center gap-3 text-[10px]">
        <!-- Legend doubles as the AREDL toggle, so clicks inside it must not
             collapse the chart. -->
        <span v-if="props.allSeries.length" class="hidden group-open:inline-flex items-center gap-1.5 text-zinc-400">
          <span class="w-2.5 h-0.5 rounded bg-accent inline-block" /> ALL moves
        </span>
        <button
          v-if="props.aredlSeries?.length"
          type="button"
          class="hidden group-open:inline-flex items-center gap-1.5 transition-colors"
          :class="showAredl ? 'text-sky-300' : 'text-zinc-600 hover:text-zinc-400'"
          @click.prevent.stop="showAredl = !showAredl"
        >
          <span class="w-2.5 h-0.5 rounded inline-block" :class="showAredl ? 'bg-sky-400' : 'bg-zinc-700'" />
          AREDL placement
        </button>
        <span class="text-zinc-600 text-[11px] group-open:rotate-180 transition-transform inline-block">▾</span>
      </div>
    </summary>
    <div class="border-t border-zinc-800/80">
      <!-- Mounted only once opened: a level with hundreds of history points
           shouldn't pay for an SVG nobody expanded. -->
      <template v-if="opened">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      class="block w-full"
      role="img"
      aria-label="Level placement over time"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <!-- Gridlines + y labels (list position, top = harder) -->
      <template v-for="t in yTicks" :key="`y-${t.pos}`">
        <line :x1="PAD.left" :x2="W - PAD.right" :y1="t.py" :y2="t.py" stroke="rgb(var(--c-zinc-800))" stroke-width="1" stroke-dasharray="2 4" />
        <text :x="PAD.left - 6" :y="t.py + 3" text-anchor="end" class="fill-zinc-500" font-size="10">#{{ t.pos.toLocaleString() }}</text>
      </template>
      <!-- X labels -->
      <text
        v-for="(t, i) in xTicks" :key="`x-${i}`"
        :x="t.px" :y="H - 8"
        :text-anchor="i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'"
        class="fill-zinc-500" font-size="10"
      >{{ t.label }}</text>

      <!-- AREDL placement over time -->
      <path v-if="showAredl && aredlPath" :d="aredlPath" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity="0.75" />
      <!-- ALL placements -->
      <path v-if="allPath" :d="allPath" fill="none" stroke="rgb(var(--c-accent))" stroke-width="2" stroke-linejoin="round" />

      <!-- Vertices -->
      <circle
        v-for="(p, i) in allVertices" :key="`pa-${i}`"
        :cx="x(p.t)" :cy="y(p.pos)" r="2.5" fill="rgb(var(--c-accent))" stroke="rgb(var(--c-zinc-950))" stroke-width="1"
      />
      <circle
        v-for="(p, i) in aredlVertices" :key="`pr-${i}`"
        :cx="x(p.t)" :cy="y(p.pos)" r="2" fill="#38bdf8" stroke="rgb(var(--c-zinc-950))" stroke-width="1"
      />

      <!-- Hover marker + tooltip -->
      <template v-if="hover">
        <line :x1="hover.px" :x2="hover.px" :y1="PAD.top" :y2="H - PAD.bottom" stroke="rgb(var(--c-zinc-700))" stroke-width="1" />
        <circle :cx="hover.px" :cy="hover.py" r="4" :fill="hover.color" stroke="rgb(var(--c-zinc-950))" stroke-width="1.5" />
        <g :transform="`translate(${Math.min(Math.max(hover.px + 8, PAD.left), W - 150)}, ${Math.max(hover.py - 34, 4)})`">
          <rect width="142" height="30" rx="6" fill="rgb(var(--c-zinc-900))" stroke="rgb(var(--c-zinc-700))" stroke-width="1" />
          <text x="8" y="13" font-size="10" class="fill-zinc-400">{{ hover.label }}</text>
          <text x="8" y="25" font-size="11" font-weight="600" :fill="hover.color">#{{ hover.pos.toLocaleString() }}</text>
        </g>
      </template>
    </svg>
      </template>
    </div>
  </details>
</template>

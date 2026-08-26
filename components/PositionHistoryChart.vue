<script setup lang="ts">
/**
 * Placement-over-time step chart. Y axis is inverted (placement #1 at the top)
 * so a line falling visually means the level fell down the list.
 *
 * Two series, each on its own scale:
 *   - `allSeries`   — this level's placement on the ALL, 1…54,000
 *   - `aredlSeries` — AREDL's own rank, 1…150ish
 *
 * They shared one axis before, which made the comparison unreadable: against a
 * 54,000-row range every AREDL rank collapses onto the top pixel, and against
 * AREDL's range the ALL line leaves the frame entirely. Each now gets its own
 * axis — ALL on the left, AREDL on the right — so both are legible and the
 * shapes can be compared even though the numbers can't.
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
const showAll = ref(true)

const W = 640
const H = 230
const PAD = { top: 14, right: 46, bottom: 26, left: 52 }

const ALL_COLOR = 'rgb(var(--c-accent))'
const AREDL_COLOR = '#38bdf8'

function parseT(at: string): number {
  // SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) or ISO — normalize to epoch ms.
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

function clean(pts: Point[] | undefined): { t: number; pos: number }[] {
  return [...(pts ?? [])]
    .map((p) => ({ t: parseT(p.at), pos: p.position }))
    .filter((p) => p.t > 0 && Number.isFinite(p.pos))
    .sort((a, b) => a.t - b.t)
}

const allPoints = computed(() => (showAll.value ? clean(props.allSeries) : []))
const aredlPoints = computed(() => (showAredl.value ? clean(props.aredlSeries) : []))

const hasData = computed(() =>
  clean(props.allSeries).length + clean(props.aredlSeries).length >= 2,
)

/** Shared time domain — the one thing the two series genuinely have in common. */
const timeDomain = computed(() => {
  const pts = [...allPoints.value, ...aredlPoints.value]
  if (!pts.length) return null
  let tMin = Infinity, tMax = -Infinity
  for (const p of pts) {
    if (p.t < tMin) tMin = p.t
    if (p.t > tMax) tMax = p.t
  }
  // Extend to "now" so the line reaches the right edge.
  const now = Date.now()
  if (now > tMax) tMax = now
  if (tMax === tMin) tMax = tMin + 1
  return { tMin, tMax }
})

/** A placement range padded so the line doesn't hug the frame. */
function rangeOf(pts: { pos: number }[]): { lo: number; hi: number } | null {
  if (!pts.length) return null
  let lo = Infinity, hi = -Infinity
  for (const p of pts) {
    if (p.pos < lo) lo = p.pos
    if (p.pos > hi) hi = p.pos
  }
  const span = Math.max(1, hi - lo)
  return { lo: Math.max(1, Math.floor(lo - span * 0.08)), hi: Math.ceil(hi + span * 0.08) }
}

const allRange = computed(() => rangeOf(allPoints.value))
const aredlRange = computed(() => rangeOf(aredlPoints.value))

function x(t: number): number {
  const d = timeDomain.value!
  return PAD.left + ((t - d.tMin) / (d.tMax - d.tMin)) * (W - PAD.left - PAD.right)
}
/** Inverted: a smaller placement (harder, higher on the list) sits at the top. */
function yIn(range: { lo: number; hi: number } | null, pos: number): number {
  if (!range) return PAD.top
  const span = range.hi - range.lo || 1
  return PAD.top + ((pos - range.lo) / span) * (H - PAD.top - PAD.bottom)
}
const yAll = (pos: number) => yIn(allRange.value, pos)
const yAredl = (pos: number) => yIn(aredlRange.value, pos)

/** Step-after path: hold each placement until the next change. */
function stepPath(
  pts: { t: number; pos: number }[],
  y: (pos: number) => number,
  extendToNow: boolean,
): string {
  if (pts.length === 0) return ''
  let dStr = `M ${x(pts[0]!.t).toFixed(1)} ${y(pts[0]!.pos).toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    dStr += ` H ${x(pts[i]!.t).toFixed(1)} V ${y(pts[i]!.pos).toFixed(1)}`
  }
  if (extendToNow) dStr += ` H ${x(timeDomain.value!.tMax).toFixed(1)}`
  return dStr
}

// Set the first time the <details> is expanded and never cleared, so
// collapsing and reopening doesn't rebuild the SVG.
const opened = ref(false)
function onToggle(e: Event) {
  if ((e.target as HTMLDetailsElement).open) opened.value = true
}

/**
 * A level nobody has moved here has exactly one ALL data point — where it sits
 * now. Drawing a line from that back across the whole time range would assert
 * it has been there since the first AREDL event, which is a claim we can't
 * make, so a lone point stays a point.
 */
const allIsSinglePoint = computed(() => allPoints.value.length === 1)
const allPath = computed(() =>
  timeDomain.value && !allIsSinglePoint.value ? stepPath(allPoints.value, yAll, true) : '',
)
const aredlPath = computed(() => (timeDomain.value ? stepPath(aredlPoints.value, yAredl, true) : ''))

// A level that has absorbed hundreds of passive ±1 shifts would render as a
// solid band of overlapping dots, so only mark vertices on sparse series.
const VERTEX_LIMIT = 60
const allVertices = computed(() => (allPoints.value.length <= VERTEX_LIMIT ? allPoints.value : []))
const aredlVertices = computed(() => (aredlPoints.value.length <= VERTEX_LIMIT ? aredlPoints.value : []))

/** Tick labels for one axis. Deduped, since a tight range rounds to repeats. */
function ticksFor(range: { lo: number; hi: number } | null, y: (pos: number) => number) {
  if (!range) return []
  const n = 4
  const out: { pos: number; py: number }[] = []
  for (let i = 0; i <= n; i++) {
    const pos = Math.round(range.lo + ((range.hi - range.lo) * i) / n)
    out.push({ pos, py: y(pos) })
  }
  return out.filter((t, i, arr) => i === 0 || t.pos !== arr[i - 1]!.pos)
}
const allTicks = computed(() => ticksFor(allRange.value, yAll))
const aredlTicks = computed(() => ticksFor(aredlRange.value, yAredl))
/** Gridlines follow whichever axis is showing; the ALL one wins when both are. */
const gridTicks = computed(() => (allTicks.value.length ? allTicks.value : aredlTicks.value))

const xTicks = computed(() => {
  const d = timeDomain.value
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
const hover = ref<{ px: number; py: number; label: string; pos: number; color: string; series: string } | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)

function onMove(e: MouseEvent) {
  if (!timeDomain.value || !svgEl.value) return
  const rect = svgEl.value.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * W
  let best: { d2: number; t: number; pos: number; py: number; color: string; series: string } | null = null
  const consider = (
    pts: { t: number; pos: number }[],
    y: (pos: number) => number,
    color: string,
    series: string,
  ) => {
    for (const p of pts) {
      const dx = x(p.t) - mx
      const d2 = dx * dx
      if (!best || d2 < best.d2) best = { d2, t: p.t, pos: p.pos, py: y(p.pos), color, series }
    }
  }
  consider(allPoints.value, yAll, ALL_COLOR, 'ALL')
  consider(aredlPoints.value, yAredl, AREDL_COLOR, 'AREDL')
  if (!best) { hover.value = null; return }
  const b = best as { t: number; pos: number; py: number; color: string; series: string }
  hover.value = {
    px: x(b.t),
    py: b.py,
    label: new Date(b.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    pos: b.pos,
    color: b.color,
    series: b.series,
  }
}
</script>

<template>
  <details
    v-if="hasData"
    class="group card overflow-hidden"
    @toggle="onToggle"
  >
    <summary class="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 list-none hover:bg-zinc-900/40 transition-colors">
      <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Placement over time</h3>
      <div class="flex items-center gap-3 text-[10px]">
        <!-- The legend doubles as the series toggles, so clicks inside it must
             not collapse the chart. -->
        <button
          v-if="props.allSeries.length"
          type="button"
          class="hidden group-open:inline-flex items-center gap-1.5 transition-colors"
          :class="showAll ? 'text-accent' : 'text-zinc-600 hover:text-zinc-400'"
          @click.prevent.stop="showAll = !showAll"
        >
          <span class="w-2.5 h-0.5 rounded inline-block" :class="showAll ? 'bg-accent' : 'bg-zinc-700'" />
          ALL placement
        </button>
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
          <!-- Gridlines -->
          <line
            v-for="t in gridTicks" :key="`g-${t.pos}`"
            :x1="PAD.left" :x2="W - PAD.right" :y1="t.py" :y2="t.py"
            stroke="rgb(var(--c-zinc-800))" stroke-width="1" stroke-dasharray="2 4"
          />
          <!-- Left axis: ALL placement -->
          <text
            v-for="t in allTicks" :key="`ya-${t.pos}`"
            :x="PAD.left - 6" :y="t.py + 3" text-anchor="end"
            :fill="ALL_COLOR" opacity="0.75" font-size="10"
          >#{{ t.pos.toLocaleString() }}</text>
          <!-- Right axis: AREDL rank, on its own scale -->
          <text
            v-for="t in aredlTicks" :key="`yr-${t.pos}`"
            :x="W - PAD.right + 6" :y="t.py + 3" text-anchor="start"
            :fill="AREDL_COLOR" opacity="0.7" font-size="10"
          >#{{ t.pos.toLocaleString() }}</text>
          <!-- X labels -->
          <text
            v-for="(t, i) in xTicks" :key="`x-${i}`"
            :x="t.px" :y="H - 8"
            :text-anchor="i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'"
            class="fill-zinc-500" font-size="10"
          >{{ t.label }}</text>

          <!-- AREDL placement over time -->
          <path v-if="aredlPath" :d="aredlPath" fill="none" :stroke="AREDL_COLOR" stroke-width="1.5" opacity="0.75" />
          <!-- ALL placements -->
          <path v-if="allPath" :d="allPath" fill="none" :stroke="ALL_COLOR" stroke-width="2" stroke-linejoin="round" />

          <!-- Vertices -->
          <circle
            v-for="(p, i) in allVertices" :key="`pa-${i}`"
            :cx="x(p.t)" :cy="yAll(p.pos)" r="2.5" :fill="ALL_COLOR" stroke="rgb(var(--c-zinc-950))" stroke-width="1"
          />
          <circle
            v-for="(p, i) in aredlVertices" :key="`pr-${i}`"
            :cx="x(p.t)" :cy="yAredl(p.pos)" r="2" :fill="AREDL_COLOR" stroke="rgb(var(--c-zinc-950))" stroke-width="1"
          />

          <!-- Hover marker + tooltip -->
          <template v-if="hover">
            <line :x1="hover.px" :x2="hover.px" :y1="PAD.top" :y2="H - PAD.bottom" stroke="rgb(var(--c-zinc-700))" stroke-width="1" />
            <circle :cx="hover.px" :cy="hover.py" r="4" :fill="hover.color" stroke="rgb(var(--c-zinc-950))" stroke-width="1.5" />
            <g :transform="`translate(${Math.min(Math.max(hover.px + 8, PAD.left), W - 150)}, ${Math.max(hover.py - 34, 4)})`">
              <rect width="142" height="30" rx="6" fill="rgb(var(--c-zinc-900))" stroke="rgb(var(--c-zinc-700))" stroke-width="1" />
              <text x="8" y="13" font-size="10" class="fill-zinc-400">{{ hover.label }}</text>
              <text x="8" y="25" font-size="11" font-weight="600" :fill="hover.color">
                {{ hover.series }} #{{ hover.pos.toLocaleString() }}
              </text>
            </g>
          </template>
        </svg>
        <p class="px-4 pb-3 text-[10px] text-zinc-600">
          Each line has its own scale: ALL placement on the left, AREDL rank on the right.
          <template v-if="allIsSinglePoint">
            This level hasn't moved yet, so its ALL placement is a single point.
          </template>
        </p>
      </template>
    </div>
  </details>
</template>

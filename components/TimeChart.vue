<script setup lang="ts">
/**
 * A series, drawn properly.
 *
 * What this replaces was a row of `<div>`s whose heights were a percentage of
 * the tallest bar. That shape can only ever answer "which one was busiest" —
 * there is no axis, so no bar has a value; there are two labels, so no bar has
 * a name; and two series can't share it, so views and people were drawn as one
 * bar in front of another and neither could be read.
 *
 * This has a y-axis with real numbers, gridlines to read them against, labels
 * along the bottom, and a hover that says exactly what every series was at the
 * point under the pointer.
 *
 * **Two axes, on purpose.** Views outnumber people by ten to one or more, so on
 * one axis the people line is a flat smear along the bottom. Anything counted
 * in views goes left, anything counted in people goes right, and each is
 * labelled in its own colour so the pairing is never a guess.
 *
 * **Two x-scales, also on purpose.** A day is an *instant* — a line from one
 * day to the next is a fair drawing of a trend. An hour is a *bucket*: "09:00"
 * means the sixty minutes after nine, and a line between bucket centres implies
 * a reading at a moment that was never taken. So a chart with any bar series
 * switches to a band scale, where every point owns a slice of the width and
 * sits in the middle of its own. Lines drawn alongside bars land on the bar
 * centres, which is what makes overlaying today on the average legible.
 */
type Point = Record<string, number | string>

/** `<script setup>` may not carry ES exports; the shape is structural anyway. */
type ChartSeries = {
  key: string
  label: string
  color: string
  /** `left` for views, `right` for people. */
  axis?: 'left' | 'right'
  kind?: 'area' | 'line' | 'bar'
  /** Dashed: a reference line, beside the series it exists to be compared with. */
  dashed?: boolean
}

const props = withDefaults(defineProps<{
  points: Point[]
  series: ChartSeries[]
  height?: number
  /** Which field carries the x value. Days by default; the hourly chart passes `hour`. */
  xKey?: string
  /** How an x value is written. Defaults to `4 Aug`, which only suits days. */
  xFormat?: (v: string | number) => string
  /** Label every Nth point. Left unset, about six labels are spread evenly. */
  xEvery?: number
  /** What one step along the bottom is, for the accessible summary. */
  xUnit?: string
}>(), {
  height: 220,
  xKey: 'day',
  xFormat: undefined,
  xEvery: 0,
  xUnit: 'days',
})

/**
 * The drawing width, measured.
 *
 * A `viewBox` with `preserveAspectRatio="none"` would stretch the text and the
 * stroke widths with the chart, so the width is measured instead and the SVG is
 * drawn at real pixels. The fallback is what the server renders with, and it is
 * close enough that hydration doesn't visibly re-lay-out.
 */
const wrap = ref<HTMLElement | null>(null)
const width = ref(760)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!wrap.value) return
  ro = new ResizeObserver(([entry]) => {
    const w = entry?.contentRect.width ?? 0
    if (w > 0) width.value = Math.round(w)
  })
  ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())

const PAD = { top: 10, right: 46, bottom: 22, left: 46 }
const plotW = computed(() => Math.max(10, width.value - PAD.left - PAD.right))
const plotH = computed(() => Math.max(10, props.height - PAD.top - PAD.bottom))
const baseY = computed(() => PAD.top + plotH.value)

const left = computed(() => props.series.filter((s) => (s.axis ?? 'left') === 'left'))
const right = computed(() => props.series.filter((s) => s.axis === 'right'))

/**
 * A maximum a person can read off an axis.
 *
 * `1, 2, 2.5, 5, 10 × 10ⁿ` — the steps that produce gridlines at round numbers.
 * A raw maximum gives an axis labelled 3,847 and gridlines at 962, which is a
 * number nobody has ever wanted to see on a chart.
 */
function niceMax(raw: number): number {
  if (raw <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (raw <= step * mag) return step * mag
  }
  return 10 * mag
}

const maxFor = (keys: ChartSeries[]) =>
  niceMax(props.points.reduce(
    (m, p) => Math.max(m, ...keys.map((s) => Number(p[s.key] ?? 0))), 0,
  ))
const leftMax = computed(() => maxFor(left.value))
const rightMax = computed(() => maxFor(right.value))

/** Buckets rather than instants: see the note at the top. */
const banded = computed(() => props.series.some((s) => s.kind === 'bar'))
const count = computed(() => props.points.length)
const stepX = computed(() => {
  if (!count.value) return 0
  if (banded.value) return plotW.value / count.value
  return count.value > 1 ? plotW.value / (count.value - 1) : 0
})
const xAt = (i: number) =>
  PAD.left + (banded.value ? i * stepX.value + stepX.value / 2 : i * stepX.value)
const yAt = (v: number, max: number) =>
  PAD.top + plotH.value - (Math.min(v, max) / max) * plotH.value

const barW = computed(() => Math.max(2, stepX.value * 0.66))
function bars(s: ChartSeries) {
  const max = (s.axis === 'right' ? rightMax : leftMax).value
  return props.points.map((p, i) => {
    const v = Number(p[s.key] ?? 0)
    const y = yAt(v, max)
    return {
      i,
      x: xAt(i) - barW.value / 2,
      y,
      /** Zero draws nothing; anything above it keeps a sliver so it is visible. */
      h: v > 0 ? Math.max(1.5, baseY.value - y) : 0,
    }
  })
}

function linePath(s: ChartSeries): string {
  const max = (s.axis === 'right' ? rightMax : leftMax).value
  return props.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(Number(p[s.key] ?? 0), max).toFixed(1)}`)
    .join(' ')
}
function areaPath(s: ChartSeries): string {
  if (!props.points.length) return ''
  const base = baseY.value.toFixed(1)
  return `${linePath(s)} L${xAt(props.points.length - 1).toFixed(1)} ${base} L${xAt(0).toFixed(1)} ${base} Z`
}

/**
 * Enough gridlines to read a value off, few enough to see through — and
 * spaced so the numbers on them go up in equal steps.
 *
 * Four intervals into a maximum of 5 gives 5, 3.75, 2.5, 1.25, 0, and rounding
 * those for display produces `5 4 3 1 0`: a ladder with one rung missing and
 * nothing wrong with the drawing, only with the labels. Five intervals divide
 * that maximum exactly. So the count is chosen to suit the numbers rather than
 * fixed, preferring one that lands whole on *both* axes, since they share the
 * lines they are labelling.
 */
const TICK_OPTIONS = [4, 5]
const ticks = computed(() => {
  const whole = (n: number, max: number) => Number.isInteger(max / n)
  for (const n of TICK_OPTIONS) {
    if (whole(n, leftMax.value) && (!right.value.length || whole(n, rightMax.value))) return n
  }
  for (const n of TICK_OPTIONS) if (whole(n, leftMax.value)) return n
  return TICK_OPTIONS[0]!
})
const round1 = (n: number) => Math.round(n * 10) / 10
const gridY = computed(() =>
  Array.from({ length: ticks.value + 1 }, (_, i) => {
    const frac = i / ticks.value
    return {
      y: PAD.top + plotH.value * frac,
      leftLabel: round1(leftMax.value * (1 - frac)),
      rightLabel: round1(rightMax.value * (1 - frac)),
    }
  }),
)

const fmt = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString())
/** An average is the one figure here that is allowed a decimal place. */
const fmtValue = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 })

function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const formatX = (v: string | number | undefined) =>
  props.xFormat ? props.xFormat(v ?? '') : shortDay(String(v ?? ''))

/** About six labels along the bottom, or every Nth when the caller says so. */
const xLabels = computed(() => {
  const n = count.value
  if (!n) return []
  const at = (i: number) => ({ x: xAt(i), label: formatX(props.points[i]![props.xKey] as string | number) })
  if (props.xEvery > 0) {
    const out: { x: number; label: string }[] = []
    for (let i = 0; i < n; i += props.xEvery) out.push(at(i))
    return out
  }
  const want = Math.min(6, n)
  const gap = Math.max(1, Math.round((n - 1) / (want - 1 || 1)))
  const out: { x: number; label: string }[] = []
  for (let i = 0; i < n; i += gap) out.push(at(i))
  const lastX = xAt(n - 1)
  if (!out.length || lastX - out[out.length - 1]!.x > stepX.value) out.push(at(n - 1))
  return out
})

// --- the hover readout
const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  const box = (e.currentTarget as SVGElement).getBoundingClientRect()
  const x = e.clientX - box.left - PAD.left
  if (!count.value) return
  if (stepX.value <= 0) { hover.value = 0; return }
  // A band owns its slice, so the pointer is *inside* one; a point scale has
  // nothing between its points, so the pointer belongs to the nearest.
  const i = banded.value ? Math.floor(x / stepX.value) : Math.round(x / stepX.value)
  hover.value = Math.max(0, Math.min(count.value - 1, i))
}
const hovered = computed(() => (hover.value == null ? null : props.points[hover.value] ?? null))
/** Flip the readout to the other side near the right edge so it stays on screen. */
const readoutLeft = computed(() => {
  if (hover.value == null) return 0
  const x = xAt(hover.value)
  return x > PAD.left + plotW.value * 0.6 ? x - 150 : x + 8
})
</script>

<template>
  <div ref="wrap" class="w-full">
    <svg
      :width="width"
      :height="height"
      class="block select-none"
      role="img"
      :aria-label="`${series.map((s) => s.label).join(' and ')} over ${points.length} ${xUnit}`"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <!-- Gridlines, with a number at each end of every one. -->
      <g>
        <line
          v-for="g in gridY"
          :key="`g-${g.y}`"
          :x1="PAD.left" :x2="PAD.left + plotW" :y1="g.y" :y2="g.y"
          stroke="currentColor" stroke-width="1" class="text-zinc-800/70"
        />
      </g>
      <g class="text-[9px] tabular-nums" font-size="9">
        <text
          v-for="g in gridY"
          :key="`l-${g.y}`"
          :x="PAD.left - 6" :y="g.y + 3" text-anchor="end"
          :fill="left[0]?.color ?? 'currentColor'" fill-opacity="0.75"
        >{{ fmt(g.leftLabel) }}</text>
        <text
          v-for="g in gridY"
          v-show="right.length"
          :key="`r-${g.y}`"
          :x="PAD.left + plotW + 6" :y="g.y + 3" text-anchor="start"
          :fill="right[0]?.color ?? 'currentColor'" fill-opacity="0.75"
        >{{ fmt(g.rightLabel) }}</text>
      </g>

      <!-- Bars first, then areas, then lines: whatever is drawn last stays
           readable, and a line over a bar is the pairing worth reading. -->
      <g v-for="s in series.filter((x) => x.kind === 'bar')" :key="`b-${s.key}`">
        <rect
          v-for="b in bars(s)"
          :key="`b-${s.key}-${b.i}`"
          :x="b.x.toFixed(1)" :y="b.y.toFixed(1)"
          :width="barW.toFixed(1)" :height="b.h.toFixed(1)"
          :fill="s.color"
          :fill-opacity="hover === b.i ? 0.95 : 0.6"
          rx="1.5"
        />
      </g>
      <path
        v-for="s in series.filter((x) => (x.kind ?? 'area') === 'area')"
        :key="`a-${s.key}`"
        :d="areaPath(s)" :fill="s.color" fill-opacity="0.16"
      />
      <path
        v-for="s in series.filter((x) => (x.kind ?? 'area') !== 'bar')"
        :key="`p-${s.key}`"
        :d="linePath(s)" fill="none" :stroke="s.color" stroke-width="1.75"
        :stroke-dasharray="s.dashed ? '4 3' : undefined"
        stroke-linejoin="round" stroke-linecap="round"
      />

      <g class="text-[9px] tabular-nums" font-size="9" fill="currentColor">
        <text
          v-for="l in xLabels"
          :key="`x-${l.x}`"
          :x="l.x" :y="height - 6" text-anchor="middle"
          class="fill-zinc-600"
        >{{ l.label }}</text>
      </g>

      <!-- What the pointer is on. -->
      <g v-if="hover != null">
        <line
          v-if="!banded"
          :x1="xAt(hover)" :x2="xAt(hover)" :y1="PAD.top" :y2="baseY"
          stroke="currentColor" stroke-width="1" class="text-zinc-600" stroke-dasharray="2 2"
        />
        <circle
          v-for="s in series.filter((x) => x.kind !== 'bar')"
          :key="`d-${s.key}`"
          :cx="xAt(hover)"
          :cy="yAt(Number(hovered?.[s.key] ?? 0), (s.axis === 'right' ? rightMax : leftMax))"
          r="3" :fill="s.color" stroke="#09090b" stroke-width="1.5"
        />
      </g>
    </svg>

    <!-- The readout is HTML rather than SVG text: it wraps, it can carry a
         swatch per series, and it doesn't need a font-size guess. -->
    <div class="relative h-0">
      <div
        v-if="hovered"
        class="pointer-events-none absolute z-10 -top-2 w-[142px] rounded-lg border border-zinc-700 bg-zinc-950/95 px-2 py-1.5 shadow-lg"
        :style="{ left: `${readoutLeft}px`, transform: `translateY(-${height - 20}px)` }"
      >
        <p class="text-[10px] text-zinc-400 tabular-nums">{{ formatX(hovered[xKey] as string | number) }}</p>
        <p
          v-for="s in series"
          :key="`t-${s.key}`"
          class="flex items-center gap-1.5 text-[11px] text-zinc-200"
        >
          <span class="w-2 h-2 rounded-sm shrink-0" :style="{ backgroundColor: s.color }" />
          <span class="flex-1 truncate text-zinc-400">{{ s.label }}</span>
          <span class="tabular-nums">{{ fmtValue(Number(hovered[s.key] ?? 0)) }}</span>
        </p>
      </div>
    </div>

    <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-400">
      <span v-for="s in series" :key="`k-${s.key}`" class="flex items-center gap-1.5">
        <span
          class="w-2.5 h-2.5 rounded-sm"
          :style="{ backgroundColor: s.dashed ? 'transparent' : s.color, boxShadow: `inset 0 0 0 1.5px ${s.color}` }"
        />
        {{ s.label }}
        <span v-if="s.axis === 'right'" class="text-zinc-600">(right)</span>
      </span>
    </div>
  </div>
</template>

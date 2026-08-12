<script setup lang="ts">
/**
 * A time series, drawn properly.
 *
 * What this replaces was a row of `<div>`s whose heights were a percentage of
 * the tallest bar. That shape can only ever answer "which day was busiest" —
 * there is no axis, so no bar has a value; there are two labels, so no bar has
 * a date; and two series can't share it, so views and people were drawn as one
 * bar in front of another and neither could be read.
 *
 * This has a y-axis with real numbers, gridlines to read them against, dates
 * along the bottom, and a hover that says exactly what every series was on the
 * day under the pointer.
 *
 * **Two axes, on purpose.** Views outnumber people by ten to one or more, so on
 * one axis the people line is a flat smear along the bottom. Anything counted
 * in views goes left, anything counted in people goes right, and each is
 * labelled in its own colour so the pairing is never a guess.
 */
type Point = { day: string } & Record<string, number | string>

/** `<script setup>` may not carry ES exports; the shape is structural anyway. */
type ChartSeries = {
  key: string
  label: string
  color: string
  /** `left` for views, `right` for people. */
  axis?: 'left' | 'right'
  kind?: 'area' | 'line'
}

const props = withDefaults(defineProps<{
  points: Point[]
  series: ChartSeries[]
  height?: number
}>(), { height: 220 })

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

const stepX = computed(() => (props.points.length > 1 ? plotW.value / (props.points.length - 1) : 0))
const xAt = (i: number) => PAD.left + i * stepX.value
const yAt = (v: number, max: number) => PAD.top + plotH.value - (Math.min(v, max) / max) * plotH.value

function linePath(s: ChartSeries): string {
  const max = (s.axis === 'right' ? rightMax : leftMax).value
  return props.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(Number(p[s.key] ?? 0), max).toFixed(1)}`)
    .join(' ')
}
function areaPath(s: ChartSeries): string {
  if (!props.points.length) return ''
  const base = (PAD.top + plotH.value).toFixed(1)
  return `${linePath(s)} L${xAt(props.points.length - 1).toFixed(1)} ${base} L${xAt(0).toFixed(1)} ${base} Z`
}

/** Five gridlines, which is enough to read a value off and few enough to see through. */
const TICKS = 4
const gridY = computed(() =>
  Array.from({ length: TICKS + 1 }, (_, i) => {
    const frac = i / TICKS
    return {
      y: PAD.top + plotH.value * frac,
      leftLabel: Math.round(leftMax.value * (1 - frac)),
      rightLabel: Math.round(rightMax.value * (1 - frac)),
    }
  }),
)

const fmt = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString())
function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** About six dates along the bottom, whatever the range. */
const xLabels = computed(() => {
  const n = props.points.length
  if (!n) return []
  const want = Math.min(6, n)
  const gap = Math.max(1, Math.round((n - 1) / (want - 1 || 1)))
  const out: { x: number; label: string }[] = []
  for (let i = 0; i < n; i += gap) out.push({ x: xAt(i), label: shortDay(props.points[i]!.day) })
  const lastX = xAt(n - 1)
  if (!out.length || lastX - out[out.length - 1]!.x > stepX.value) {
    out.push({ x: lastX, label: shortDay(props.points[n - 1]!.day) })
  }
  return out
})

// --- the hover readout
const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  const box = (e.currentTarget as SVGElement).getBoundingClientRect()
  const x = e.clientX - box.left - PAD.left
  if (!props.points.length) return
  const i = stepX.value > 0 ? Math.round(x / stepX.value) : 0
  hover.value = Math.max(0, Math.min(props.points.length - 1, i))
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
      :aria-label="`${series.map((s) => s.label).join(' and ')} over ${points.length} days`"
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

      <!-- Areas first, so the lines on the other axis stay readable over them. -->
      <path
        v-for="s in series.filter((x) => (x.kind ?? 'area') === 'area')"
        :key="`a-${s.key}`"
        :d="areaPath(s)" :fill="s.color" fill-opacity="0.16"
      />
      <path
        v-for="s in series"
        :key="`p-${s.key}`"
        :d="linePath(s)" fill="none" :stroke="s.color" stroke-width="1.75"
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
          :x1="xAt(hover)" :x2="xAt(hover)" :y1="PAD.top" :y2="PAD.top + plotH"
          stroke="currentColor" stroke-width="1" class="text-zinc-600" stroke-dasharray="2 2"
        />
        <circle
          v-for="s in series"
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
        <p class="text-[10px] text-zinc-400 tabular-nums">{{ shortDay(String(hovered.day)) }}</p>
        <p
          v-for="s in series"
          :key="`t-${s.key}`"
          class="flex items-center gap-1.5 text-[11px] text-zinc-200"
        >
          <span class="w-2 h-2 rounded-sm shrink-0" :style="{ backgroundColor: s.color }" />
          <span class="flex-1 truncate text-zinc-400">{{ s.label }}</span>
          <span class="tabular-nums">{{ Number(hovered[s.key] ?? 0).toLocaleString() }}</span>
        </p>
      </div>
    </div>

    <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-400">
      <span v-for="s in series" :key="`k-${s.key}`" class="flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-sm" :style="{ backgroundColor: s.color }" />
        {{ s.label }}
        <span v-if="s.axis === 'right'" class="text-zinc-600">(right)</span>
      </span>
    </div>
  </div>
</template>

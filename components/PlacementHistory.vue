<script setup lang="ts">
/**
 * Where a level has been ranked over time, on this list or on AREDL.
 *
 * One source at a time, each on its own scale: the ALL runs to 55,000 and
 * AREDL to a few hundred, so one axis for both made one of them a flat line.
 * The summary and the timeline render on the server; the chart waits for the
 * browser because it is drawn up to "now", which the two would disagree on.
 */
type AllEntry = {
  id: number
  from_position: number | null
  to_position: number
  changed_at: string
  changed_by: string | null
}
type AredlEntry = {
  event?: string | null
  aredl_position: number | null
  cause_name?: string | null
  action_at: string
}

const props = defineProps<{
  /** This list's moves, newest first. */
  all: AllEntry[]
  /** AREDL's trace for this level, oldest first. */
  aredl: AredlEntry[]
  /** Where the level is now. */
  current: number
  canEdit?: boolean
}>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const { locale } = useLocale()

type Source = 'all' | 'aredl'
const hasAredl = computed(() => props.aredl.some((e) => e.aredl_position != null))
const source = ref<Source>(props.all.length || !hasAredl.value ? 'all' : 'aredl')
const sourceModel = computed({
  get: () => source.value as string,
  set: (v: string) => { source.value = v as Source; expanded.value = false; showShifts.value = false },
})

function parseT(at: string): number {
  const t = Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`)
  return Number.isNaN(t) ? 0 : t
}
function fmtDate(t: number, opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }): string {
  return new Date(t).toLocaleDateString(locale.value, { ...opts, timeZone: 'UTC' })
}
const n = (v: number) => v.toLocaleString(locale.value)

// ---------------------------------------------------------------- events

type Kind = 'added' | 'up' | 'down' | 'shift-up' | 'shift-down'
type Item = {
  key: string
  id?: number
  t: number
  kind: Kind
  from: number | null
  to: number
  by?: string | null
  cause?: string | null
  event?: string | null
}

const allItems = computed<Item[]>(() => props.all.map((h) => ({
  key: `a${h.id}`,
  id: h.id,
  t: parseT(h.changed_at),
  kind: h.from_position == null ? 'added' : h.to_position < h.from_position ? 'up' : 'down',
  from: h.from_position,
  to: h.to_position,
  by: h.changed_by,
})))

/** AREDL's events, newest first, with each one's previous rank filled in. */
const aredlItems = computed<Item[]>(() => {
  const out: Item[] = []
  let prev: number | null = null
  props.aredl.forEach((e, i) => {
    if (e.aredl_position == null) return
    const own = e.event === 'Placed' || e.event === 'MovedUp' || e.event === 'MovedDown'
    const kind: Kind = e.event === 'Placed' || prev == null
      ? 'added'
      : own
        ? (e.aredl_position < prev ? 'up' : 'down')
        : (e.aredl_position < prev ? 'shift-up' : 'shift-down')
    out.push({ key: `r${i}`, t: parseT(e.action_at), kind, from: kind === 'added' ? null : prev, to: e.aredl_position, cause: e.cause_name, event: e.event })
    prev = e.aredl_position
  })
  return out.reverse()
})

const items = computed(() => (source.value === 'all' ? allItems.value : aredlItems.value))
const isShift = (i: Item) => i.kind === 'shift-up' || i.kind === 'shift-down'
const ownItems = computed(() => items.value.filter((i) => !isShift(i)))
const shiftCount = computed(() => items.value.length - ownItems.value.length)

const showShifts = ref(false)
const expanded = ref(false)
const LIMIT = 6
const listed = computed(() => (showShifts.value ? items.value : ownItems.value))
const shown = computed(() => (expanded.value ? listed.value : listed.value.slice(0, LIMIT)))

function title(i: Item): string {
  const d = i.from != null ? Math.abs(i.to - i.from) : 0
  switch (i.kind) {
    case 'added': return source.value === 'aredl' ? `Placed at #${n(i.to)}` : `Added at #${n(i.to)}`
    case 'up': return `Moved up ${n(d)}`
    case 'down': return `Moved down ${n(d)}`
    case 'shift-up': return i.cause ? `Up ${n(d)} after ${i.cause} moved down` : `Up ${n(d)}`
    case 'shift-down': return i.cause
      ? (i.event === 'OtherPlaced' ? `Down ${n(d)}: ${i.cause} was placed above it` : `Down ${n(d)}: ${i.cause} moved above it`)
      : `Down ${n(d)}`
  }
}
const tone: Record<Kind, string> = {
  added: 'bg-sky-400',
  up: 'bg-emerald-400',
  down: 'bg-rose-400',
  'shift-up': 'bg-zinc-600',
  'shift-down': 'bg-zinc-600',
}
const textTone: Record<Kind, string> = {
  added: 'text-sky-300',
  up: 'text-emerald-300',
  down: 'text-rose-300',
  'shift-up': 'text-zinc-400',
  'shift-down': 'text-zinc-400',
}

// ---------------------------------------------------------------- series + summary

type Point = { t: number; pos: number }

/** Oldest first, with where the level is now as the last point. */
const points = computed<Point[]>(() => {
  const asc = [...items.value].sort((a, b) => a.t - b.t)
  const pts: Point[] = []
  asc.forEach((i, idx) => {
    if (idx === 0 && i.from != null) pts.push({ t: i.t, pos: i.from })
    pts.push({ t: i.t, pos: i.to })
  })
  // Held until now: the ALL at the level's current rank, AREDL at its last.
  if (source.value === 'all') pts.push({ t: Number.POSITIVE_INFINITY, pos: props.current })
  else if (pts.length) pts.push({ t: Number.POSITIVE_INFINITY, pos: pts[pts.length - 1]!.pos })
  return pts
})

const now = computed(() => (source.value === 'all' ? props.current : (aredlItems.value[0]?.to ?? null)))
const extremes = computed(() => {
  let best: Point | null = null
  let worst: Point | null = null
  for (const p of points.value) {
    if (!best || p.pos < best.pos) best = p
    if (!worst || p.pos > worst.pos) worst = p
  }
  return { best, worst }
})
const moveCount = computed(() => ownItems.value.filter((i) => i.kind === 'up' || i.kind === 'down').length)
const firstSeen = computed(() => {
  const ts = points.value.map((p) => p.t).filter((t) => Number.isFinite(t))
  return ts.length ? Math.min(...ts) : null
})

// ---------------------------------------------------------------- chart

const mounted = ref(false)
onMounted(() => { mounted.value = true })

/** Something recorded, and somewhere to draw it to. */
const chartable = computed(() => points.value.some((p) => Number.isFinite(p.t)) && points.value.length >= 2)

const VW = 1000
const VH = 200
const PAD_Y = 14

const domain = computed(() => {
  const finite = points.value.filter((p) => Number.isFinite(p.t))
  const tMin = finite.length ? Math.min(...finite.map((p) => p.t)) : Date.now()
  let tMax = Math.max(Date.now(), ...finite.map((p) => p.t))
  if (tMax <= tMin) tMax = tMin + 86_400_000
  let lo = Math.min(...points.value.map((p) => p.pos))
  let hi = Math.max(...points.value.map((p) => p.pos))
  if (lo === hi) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.08
  return { tMin, tMax, lo: Math.max(1, lo - pad), hi: hi + pad }
})

const xOf = (t: number) => {
  const d = domain.value
  const tt = Number.isFinite(t) ? t : d.tMax
  return ((tt - d.tMin) / (d.tMax - d.tMin)) * VW
}
/** Rank 1 at the top: a line going down is the level going down the list. */
const yOf = (pos: number) => {
  const d = domain.value
  return PAD_Y + ((pos - d.lo) / (d.hi - d.lo)) * (VH - PAD_Y * 2)
}

const linePath = computed(() => {
  const pts = points.value
  if (!pts.length) return ''
  let s = `M ${xOf(pts[0]!.t).toFixed(1)} ${yOf(pts[0]!.pos).toFixed(1)}`
  for (let i = 1; i < pts.length; i++) s += ` H ${xOf(pts[i]!.t).toFixed(1)} V ${yOf(pts[i]!.pos).toFixed(1)}`
  return s + ` H ${VW}`
})
const areaPath = computed(() => (linePath.value ? `${linePath.value} V ${VH} H ${xOf(points.value[0]!.t).toFixed(1)} Z` : ''))

function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const f = raw / mag
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag
}
const yTicks = computed(() => {
  const { lo, hi } = domain.value
  const step = niceStep((hi - lo) / 4)
  const out: { pos: number; top: number }[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    if (v < 1) continue
    out.push({ pos: v, top: (yOf(v) / VH) * 100 })
  }
  return out
})
const xTicks = computed(() => {
  const { tMin, tMax } = domain.value
  const span = tMax - tMin
  const long = span > 300 * 86_400_000
  const opts: Intl.DateTimeFormatOptions = long ? { year: 'numeric', month: 'short' } : { month: 'short', day: 'numeric' }
  // A history that fits in a few days has no middle worth labelling.
  const at = span < 3 * 86_400_000 ? [0, 1] : [0, 0.5, 1]
  return at.map((f) => ({ left: f * 100, label: f === 1 ? 'Now' : fmtDate(tMin + span * f, opts) }))
})

/** Dots on the moves themselves, when there are few enough to read. */
const markers = computed(() => {
  const own = items.value.filter((i) => !isShift(i))
  if (own.length > 40) return []
  return own.map((i) => ({ key: i.key, left: (xOf(i.t) / VW) * 100, top: (yOf(i.to) / VH) * 100, kind: i.kind }))
})

const plot = ref<HTMLElement | null>(null)
const hover = ref<{ left: number; top: number; pos: number; t: number } | null>(null)
function onPointer(e: PointerEvent) {
  const el = plot.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  const d = domain.value
  const t = d.tMin + frac * (d.tMax - d.tMin)
  // The rank in force at that moment: the last point at or before it.
  let at: Point = points.value[0]!
  for (const p of points.value) {
    if (Number.isFinite(p.t) && p.t <= t) at = p
    else if (Number.isFinite(p.t)) break
  }
  if (frac >= 0.999) at = { t, pos: points.value[points.value.length - 1]!.pos }
  hover.value = { left: frac * 100, top: (yOf(at.pos) / VH) * 100, pos: at.pos, t }
}

// ---------------------------------------------------------------- staff

const removing = ref<number | null>(null)
async function remove(id: number) {
  if (removing.value != null) return
  removing.value = id
  try {
    await $fetch(`/api/admin/position-history/${id}`, { method: 'DELETE' })
    emit('refresh')
  } finally {
    removing.value = null
  }
}

const gradientId = `ph-fill-${useId()}`
</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="section-title">Placement history</h2>
      <SegmentedControl
        v-if="all.length && hasAredl"
        v-model="sourceModel"
        aria-label="Whose ranking"
        :options="[
          { value: 'all', label: 'This list' },
          { value: 'aredl', label: 'AREDL' },
        ]"
      />
    </div>

    <div class="card overflow-hidden">
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800/80 border-b border-zinc-800">
        <div class="ph-stat">
          <dt>{{ source === 'aredl' ? 'On AREDL' : 'Now' }}</dt>
          <dd class="text-accent">{{ now != null ? `#${n(now)}` : '—' }}</dd>
        </div>
        <div class="ph-stat">
          <dt>Highest</dt>
          <dd>{{ extremes.best ? `#${n(extremes.best.pos)}` : '—' }}</dd>
          <p v-if="extremes.best && Number.isFinite(extremes.best.t)">{{ fmtDate(extremes.best.t) }}</p>
        </div>
        <div class="ph-stat">
          <dt>Lowest</dt>
          <dd>{{ extremes.worst ? `#${n(extremes.worst.pos)}` : '—' }}</dd>
          <p v-if="extremes.worst && Number.isFinite(extremes.worst.t)">{{ fmtDate(extremes.worst.t) }}</p>
        </div>
        <div class="ph-stat">
          <dt>Moves</dt>
          <dd>{{ n(moveCount) }}</dd>
          <p v-if="firstSeen">since {{ fmtDate(firstSeen, { year: 'numeric', month: 'short' }) }}</p>
        </div>
      </dl>

      <div v-if="chartable" class="px-3 pt-4 pb-2">
        <div class="flex">
          <div class="relative w-14 shrink-0 h-44 sm:h-52" aria-hidden="true">
            <span
              v-for="tk in yTicks"
              :key="tk.pos"
              class="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-zinc-500"
              :style="{ top: `${tk.top}%` }"
            >#{{ n(tk.pos) }}</span>
          </div>
          <div
            ref="plot"
            class="relative flex-1 h-44 sm:h-52 touch-none"
            role="img"
            :aria-label="`Placement over time, from #${n(points[0]!.pos)} to #${n(points[points.length - 1]!.pos)}`"
            @pointermove="onPointer"
            @pointerdown="onPointer"
            @pointerleave="hover = null"
          >
            <svg v-if="mounted" class="absolute inset-0 w-full h-full overflow-visible" :viewBox="`0 0 ${VW} ${VH}`" preserveAspectRatio="none">
              <defs>
                <linearGradient :id="gradientId" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stop-color="rgb(var(--c-accent))" stop-opacity="0.28" />
                  <stop offset="1" stop-color="rgb(var(--c-accent))" stop-opacity="0" />
                </linearGradient>
              </defs>
              <line
                v-for="tk in yTicks"
                :key="`g${tk.pos}`"
                x1="0" :x2="VW" :y1="(tk.top / 100) * VH" :y2="(tk.top / 100) * VH"
                stroke="rgb(var(--c-zinc-800))" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"
              />
              <path :d="areaPath" :fill="`url(#${gradientId})`" />
              <path :d="linePath" fill="none" stroke="rgb(var(--c-accent))" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
            </svg>
            <template v-if="mounted">
              <span
                v-for="m in markers"
                :key="m.key"
                class="absolute w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2 ring-2 ring-zinc-950 pointer-events-none"
                :class="tone[m.kind]"
                :style="{ left: `${m.left}%`, top: `${m.top}%` }"
              />
              <template v-if="hover">
                <span class="absolute inset-y-0 w-px bg-zinc-600 pointer-events-none" :style="{ left: `${hover.left}%` }" />
                <span
                  class="absolute w-3 h-3 rounded-full bg-accent ring-2 ring-zinc-950 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  :style="{ left: `${hover.left}%`, top: `${hover.top}%` }"
                />
                <div
                  class="absolute z-10 popover px-2.5 py-1.5 pointer-events-none whitespace-nowrap -translate-y-full"
                  :class="hover.left > 60 ? '-translate-x-full -ml-3' : 'ml-3'"
                  :style="{ left: `${hover.left}%`, top: `${Math.max(hover.top, 18)}%` }"
                >
                  <p class="text-[11px] text-zinc-400">{{ fmtDate(hover.t) }}</p>
                  <p class="rank text-sm text-zinc-50">#{{ n(hover.pos) }}</p>
                </div>
              </template>
            </template>
          </div>
        </div>
        <div class="relative ml-14 h-5 mt-1 text-[11px] text-zinc-500" aria-hidden="true">
          <span
            v-for="(tk, i) in xTicks"
            :key="i"
            class="absolute top-0 whitespace-nowrap"
            :class="i === 0 ? '' : i === xTicks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'"
            :style="{ left: `${tk.left}%` }"
          >{{ tk.label }}</span>
        </div>
      </div>
      <p v-else class="px-4 py-5 text-sm text-zinc-500">
        <template v-if="source === 'all'">No moves recorded. It is at #{{ n(current) }}.</template>
        <template v-else>No AREDL history.</template>
      </p>
    </div>

    <ol v-if="shown.length" class="mt-4 ml-1.5 border-l border-zinc-800">
      <li v-for="i in shown" :key="i.key" class="relative pl-5 pb-3 last:pb-0 group">
        <span class="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-zinc-950" :class="tone[i.kind]" aria-hidden="true" />
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span class="text-sm font-medium" :class="textTone[i.kind]">{{ title(i) }}</span>
          <span v-if="i.from != null" class="text-sm tabular-nums text-zinc-400">#{{ n(i.from) }} → <span class="text-zinc-200">#{{ n(i.to) }}</span></span>
          <span class="ml-auto text-xs tabular-nums text-zinc-500">{{ fmtDate(i.t) }}</span>
          <button
            v-if="canEdit && i.id != null"
            type="button"
            class="text-xs text-zinc-600 hover:text-red-300 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            :disabled="removing != null"
            title="Remove from the changelog"
            @click="remove(i.id)"
          >Remove</button>
        </div>
        <p v-if="i.by" class="text-xs text-zinc-500">by {{ i.by }}</p>
      </li>
    </ol>

    <div v-if="listed.length > LIMIT || shiftCount" class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <button v-if="listed.length > LIMIT" type="button" class="text-zinc-400 hover:text-accent" @click="expanded = !expanded">
        {{ expanded ? 'Show fewer' : `Show all ${n(listed.length)}` }}
      </button>
      <button v-if="shiftCount" type="button" class="text-zinc-500 hover:text-accent" @click="showShifts = !showShifts; expanded = false">
        {{ showShifts ? 'Hide shifts from other levels' : `Show ${n(shiftCount)} shifts from other levels` }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.ph-stat {
  @apply bg-zinc-950 px-4 py-3;
}
.ph-stat dt {
  @apply text-xs text-zinc-500;
}
.ph-stat dd {
  @apply mt-0.5 font-display text-lg font-semibold tabular-nums text-zinc-100;
}
.ph-stat p {
  @apply text-[11px] text-zinc-500;
}
</style>

<script setup lang="ts">
import { GDTPL_LISTS } from '~/utils/list-source-catalog'

/**
 * Imports, placement tools and the sheet report.
 *
 * It was one page of nine sections, with the import list (what you open the tab
 * for nine times in ten) at the bottom under the repair tools. Three views now,
 * the importers first, and what is running pinned above all three.
 */
const toast = useAdminToast()
const { confirm } = useConfirmDialog()

type View = 'sources' | 'placements' | 'report'
const view = ref<View>('sources')
const viewModel = computed({ get: () => view.value as string, set: (v: string) => { view.value = v as View } })

// ---------------------------------------------------------------- sources
type ImportSource = {
  key: string
  label: string
  /** One line under the name, so a four-letter acronym says what it is. */
  blurb?: string
  /** The list's own website, when it has one. */
  href?: string
  // Sources that don't write to pending_levels can't have anything to clear.
  pendingKey: string | null
}
type ImportGroup = { heading: string; note?: string; sources: ImportSource[] }

/**
 * The GDListTemplate lists, straight from the server-side registry, so the
 * panel can never offer a list the runner doesn't know or miss one it does.
 */
const gdtplIn = (group: 'demon' | 'challenge' | 'community'): ImportSource[] =>
  GDTPL_LISTS.filter((l) => l.group === group).map((l) => ({
    key: l.slug, label: l.short, blurb: l.blurb, pendingKey: l.slug, href: l.url,
  }))

const IMPORT_GROUPS: ImportGroup[] = [
  {
    heading: 'The list',
    note: 'The Google Sheet this site is built from. Start here.',
    sources: [
      { key: 'sheet',         label: 'Full re-import',    blurb: 'Every tab, then re-order the list', pendingKey: 'sheet' },
      { key: 'sheet-pending', label: 'Pending list only', blurb: 'Just the sheet’s pending tab', pendingKey: 'sheet' },
    ],
  },
  {
    heading: 'Demon lists',
    note: 'Levels this list doesn’t have arrive as pending.',
    sources: [
      { key: 'gdl', label: 'GDL', blurb: 'Geometry Dash Demonlist', pendingKey: 'gdl' },
      ...gdtplIn('demon'),
    ],
  },
  {
    heading: 'Challenge lists',
    note: 'Scored on the challenge scale.',
    sources: [
      { key: 'mscl', label: 'MSCL', blurb: 'Mega Spam Challenge List', pendingKey: null },
      // A community challenge sheet, not run by this project.
      { key: 'acs', label: 'ACS', blurb: 'ALL Challenges Sheet, community-run', pendingKey: 'acs' },
      ...gdtplIn('challenge'),
    ],
  },
  {
    heading: 'Community lists',
    note: 'Smaller and joke lists. Rarely urgent.',
    sources: gdtplIn('community'),
  },
  {
    heading: 'Records & players',
    note: 'Feeds the leaderboards. Adds no levels.',
    sources: [
      { key: 'aredl',            label: 'AREDL',            blurb: 'Records, players, creators. Slow', pendingKey: null },
      // The full import makes two detail calls per level; placements need none
      // of that, and this is the repair when a long run dies partway.
      { key: 'aredl-placements', label: 'AREDL placements', blurb: 'List positions only. Fast', pendingKey: null },
      { key: 'aredl-history',    label: 'AREDL history',    blurb: 'Past placements. Slow', pendingKey: null },
      { key: 'pointercrate',     label: 'Pointercrate',     blurb: 'Records and players', pendingKey: null },
      { key: 'gsv',              label: 'Stats Viewer',     blurb: 'Player stats', pendingKey: null },
    ],
  },
]
const IMPORT_SOURCES = IMPORT_GROUPS.flatMap((g) => g.sources)
const labelOf = (key: string) => IMPORT_SOURCES.find((s) => s.key === key)?.label ?? key

type ImportProgress = { phase: string; done: number; total: number | null; startedAt: number; updatedAt: number }
const status = ref<{
  pendingCounts: Record<string, number>
  running: string[]
  queued: string[]
  progress: Record<string, ImportProgress>
}>({ pendingCounts: {}, running: [], queued: [], progress: {} })

const unaccepted = (s: ImportSource) => (s.pendingKey ? (status.value.pendingCounts[s.pendingKey] ?? 0) : 0)
const groupUnaccepted = (g: ImportGroup) => g.sources.reduce((n, s) => n + unaccepted(s), 0)
// Both sheet rows share one pending key; count it once.
const totalUnaccepted = computed(() => {
  const keys = new Set(IMPORT_SOURCES.map((s) => s.pendingKey).filter((k): k is string => !!k))
  return [...keys].reduce((n, k) => n + (status.value.pendingCounts[k] ?? 0), 0)
})

async function loadStatus() {
  try { status.value = await $fetch('/api/admin/imports/status') } catch { /* non-fatal */ }
}

/** Whole seconds since an import started, for the "running for" readout. */
const nowTick = ref(Date.now())
function elapsed(ms: number): string {
  const s = Math.max(0, Math.round((nowTick.value - ms) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * A percentage, or null when the phase can't count itself. "Fetching the
 * sheet" has no denominator until the fetch returns, and a bar that invents one
 * is worse than a bar that says it doesn't know.
 */
function progressPct(p: ImportProgress | undefined): number | null {
  if (!p || p.total == null || p.total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)))
}

const busy = reactive<Record<string, boolean>>({})
async function runImport(src: ImportSource) {
  if (busy[src.key]) return
  busy[src.key] = true
  try {
    const res = await $fetch<{ started: boolean; queued: boolean }>('/api/admin/imports/run', { method: 'POST', body: { source: src.key } })
    toast.ok(res.queued ? `${src.label} queued. It starts when the current run finishes.` : `Started ${src.label}.`)
    await loadStatus()
  } catch (e) {
    toast.fail(e, 'Could not start that import.')
  } finally {
    busy[src.key] = false
  }
}

async function clearPending(src: ImportSource) {
  if (!src.pendingKey) return
  const count = unaccepted(src)
  if (!count) return
  if (!(await confirm({
    title: `Delete ${count.toLocaleString()} unaccepted ${count === 1 ? 'level' : 'levels'}?`,
    message: `Every pending level imported from ${src.label} that nobody has accepted yet. This can’t be undone.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  }))) return
  try {
    const res = await $fetch<{ deleted: number }>('/api/admin/imports/clear-pending', { method: 'POST', body: { source: src.pendingKey } })
    toast.ok(`Removed ${res.deleted.toLocaleString()} unaccepted ${res.deleted === 1 ? 'level' : 'levels'}.`)
    await loadStatus()
  } catch (e) {
    toast.fail(e)
  }
}

async function clearAllPending() {
  const total = totalUnaccepted.value
  if (!total) return
  if (!(await confirm({
    title: `Delete all ${total.toLocaleString()} unaccepted imported levels?`,
    message: 'From every source. Accepted levels are untouched. This can’t be undone.',
    confirmLabel: 'Delete all',
    tone: 'danger',
  }))) return
  try {
    const res = await $fetch<{ deleted: number }>('/api/admin/imports/clear-pending', { method: 'POST', body: { source: 'all' } })
    toast.ok(`Removed ${res.deleted.toLocaleString()} unaccepted ${res.deleted === 1 ? 'level' : 'levels'}.`)
    await loadStatus()
  } catch (e) {
    toast.fail(e)
  }
}

// 1.5s: this drives a progress bar, and a bar that steps five times a minute
// reads as a stall.
let statusTimer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  loadStatus()
  loadHandover()
  statusTimer = setInterval(loadStatus, 1_500)
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1_000)
})
onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
  if (tickTimer) clearInterval(tickTimer)
})

// ---------------------------------------------------------------- placements
const repairing = ref(false)
async function repairPlacements() {
  if (repairing.value) return
  repairing.value = true
  try {
    const res = await $fetch<{ changed: number; inversions_before: number; inversions_after: number }>(
      '/api/admin/repair-placements', { method: 'POST' },
    )
    toast.ok(res.changed === 0
      ? 'Placements were already in order. Nothing to fix.'
      : `Rewrote ${res.changed.toLocaleString()} ${res.changed === 1 ? 'placement' : 'placements'} (${res.inversions_before} out of order, now ${res.inversions_after}).`)
  } catch (e) {
    toast.fail(e, 'Repair failed.')
  } finally {
    repairing.value = false
  }
}

type HandoverItem = {
  level_id: number
  position: number
  name: string
  gd_id: number | null
  reason: 'permanent' | 'site_only' | 'both'
  sheet: { name: string; sheet_placement: number | null; gddl_tier: string | null } | null
}
const handover = ref<{ items: HandoverItem[]; total: number; matched: number } | null>(null)
const handoverBusy = ref<number | 'all' | null>(null)

async function loadHandover() {
  try { handover.value = await $fetch('/api/admin/sheet-handover') } catch { /* non-fatal */ }
}

async function handOver(target: number | 'all') {
  if (handoverBusy.value != null) return
  const matched = handover.value?.matched ?? 0
  if (target === 'all' && !(await confirm({
    title: `Hand ${matched.toLocaleString()} ${matched === 1 ? 'level' : 'levels'} to the sheet?`,
    message: 'Their data here is replaced with the sheet’s, and the importer keeps them updated from then on.',
    confirmLabel: 'Hand over',
  }))) return
  handoverBusy.value = target
  try {
    const res = await $fetch<{ handed_over: number; skipped: number }>(
      '/api/admin/sheet-handover/apply',
      { method: 'POST', body: target === 'all' ? { matched: true } : { level_id: target } },
    )
    toast.ok(res.handed_over === 0
      ? 'Nothing changed.'
      : `${res.handed_over} ${res.handed_over === 1 ? 'level' : 'levels'} handed to the sheet.${res.skipped ? ` ${res.skipped} skipped.` : ''}`)
    await loadHandover()
  } catch (e) {
    toast.fail(e)
  } finally {
    handoverBusy.value = null
  }
}

/** Fetched rather than linked, so a 403 is reported here instead of opening as a page. */
async function download(url: string, query: Record<string, string>, filename: string): Promise<Blob | null> {
  const blob = await $fetch<Blob>(url, { query, responseType: 'blob' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
  return blob
}
const today = () => new Date().toISOString().slice(0, 10)

const snapshotBusy = ref<'json' | 'csv' | null>(null)
async function downloadPlacements(format: 'json' | 'csv') {
  if (snapshotBusy.value) return
  snapshotBusy.value = format
  try {
    await download('/api/admin/placements/export', { format }, `all-placements-${today()}.${format}`)
  } catch (e) {
    toast.fail(e, 'Could not build the file.')
  } finally {
    snapshotBusy.value = null
  }
}

type RestoreMove = { level_id: number; name: string; from_position: number; to_position: number }
type RestoreResult = {
  read?: 'json' | 'csv'
  backup?: string | null
  matched: number; unmatched: number; untouched_extra: number
  moved: number; retiered?: number; sample: RestoreMove[]; applied: boolean
}

const restoreInput = ref<HTMLInputElement | null>(null)
const restoreName = ref<string | null>(null)
const restoreText = ref<string | null>(null)
const restorePreview = ref<RestoreResult | null>(null)
const restoreBusy = ref(false)

function pickRestoreFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  restorePreview.value = null
  restoreText.value = null
  restoreName.value = file?.name ?? null
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { restoreText.value = String(reader.result ?? ''); sendRestore(false) }
  reader.onerror = () => toast.err('Could not read that file.')
  reader.readAsText(file)
}

/** The preview and the write are the same request with one flag flipped, so what is approved is what runs. */
async function sendRestore(apply: boolean) {
  if (!restoreText.value || restoreBusy.value) return
  restoreBusy.value = true
  try {
    const res = await $fetch<RestoreResult>('/api/admin/placements/restore', {
      method: 'POST',
      query: apply ? { apply: '1' } : {},
      body: restoreText.value,
      headers: { 'Content-Type': 'text/plain' },
    })
    restorePreview.value = res
    if (apply) {
      toast.ok(res.moved === 0
        ? 'The list already matches that file. Nothing moved.'
        : `Restored ${res.moved.toLocaleString()} ${res.moved === 1 ? 'level' : 'levels'}.${res.backup ? ` The previous order is saved as ${res.backup}.` : ''}`)
      restorePreview.value = null
      restoreText.value = null
      restoreName.value = null
      if (restoreInput.value) restoreInput.value.value = ''
    }
  } catch (e) {
    toast.fail(e)
  } finally {
    restoreBusy.value = false
  }
}

async function applyRestore() {
  const p = restorePreview.value
  if (!p) return
  if (!(await confirm({
    title: `Move ${p.moved.toLocaleString()} ${p.moved === 1 ? 'level' : 'levels'} to match this file?`,
    message: p.unmatched > 0 ? `${p.unmatched.toLocaleString()} rows in the file match no level here and will be ignored.` : 'The current order is backed up first.',
    confirmLabel: 'Restore',
  }))) return
  sendRestore(true)
}

const resetPreview = ref<RestoreResult | null>(null)
const resetBusy = ref(false)
async function sheetReset(apply: boolean) {
  if (resetBusy.value) return
  resetBusy.value = true
  try {
    const res = await $fetch<RestoreResult>('/api/admin/placements/reset-to-sheet', {
      method: 'POST', query: apply ? { apply: '1' } : {},
    })
    resetPreview.value = res
    if (apply) {
      toast.ok(res.moved === 0
        ? 'Already in sheet order. Nothing moved.'
        : `${res.moved.toLocaleString()} ${res.moved === 1 ? 'level' : 'levels'} moved back to the sheet’s order.${res.backup ? ` The previous order is saved as ${res.backup}.` : ''}`)
      resetPreview.value = null
    }
  } catch (e) {
    toast.fail(e)
  } finally {
    resetBusy.value = false
  }
}
async function applySheetReset() {
  const p = resetPreview.value
  if (!p) return
  if (!(await confirm({
    title: `Move ${p.moved.toLocaleString()} ${p.moved === 1 ? 'level' : 'levels'} back to the sheet’s order?`,
    message: 'Every move made on this site to a sheet-backed level is undone. The current order is backed up first.',
    confirmLabel: 'Reset',
    tone: 'danger',
  }))) return
  sheetReset(true)
}

// ---------------------------------------------------------------- report
type ReportKind = 'json' | 'csv' | 'full'
const reportBusy = ref<ReportKind | null>(null)
const reportSummary = ref<string | null>(null)
async function downloadReport(kind: ReportKind) {
  if (reportBusy.value) return
  reportBusy.value = kind
  try {
    const blob = await download(
      '/api/admin/sheet-report',
      kind === 'csv' ? { format: 'csv' } : kind === 'full' ? { full: '1' } : {},
      kind === 'csv' ? `all-placement-drift-${today()}.csv` : `all-sheet-report-${today()}.json`,
    )
    if (blob && kind !== 'csv') {
      // Summarised while it is in hand, so the admin knows whether the file is worth opening.
      try {
        const t = JSON.parse(await blob.text()).totals ?? {}
        reportSummary.value =
          `${(t.drift_points ?? 0).toLocaleString()} drift points across ${(t.offset_runs ?? 0).toLocaleString()} offset runs; `
          + `${(t.placement_mismatches ?? 0).toLocaleString()} levels numbered differently. `
          + `${(t.site_only ?? 0).toLocaleString()} site-only, ${(t.sheet_exclusive ?? 0).toLocaleString()} sheet-exclusive.`
      } catch { reportSummary.value = null }
    }
  } catch (e) {
    toast.fail(e, 'Could not build the report.')
  } finally {
    reportBusy.value = null
  }
}
</script>

<template>
  <AdminSection title="Imports" description="Re-run the importers, keep the list’s order safe, and compare the site with the sheet." width="lg">
    <template #actions>
      <SegmentedControl
        v-model="viewModel"
        aria-label="Imports view"
        :options="[
          { value: 'sources', label: 'Importers' },
          { value: 'placements', label: 'Placements' },
          { value: 'report', label: 'Sheet report' },
        ]"
      />
    </template>

    <!-- What is running, whichever view is open. -->
    <div v-if="status.running.length || status.queued.length" class="card mb-5 p-4 space-y-3 border-amber-900/50">
      <div v-for="key in status.running" :key="key">
        <div class="flex items-baseline justify-between gap-3 text-xs mb-1.5">
          <span class="min-w-0 truncate">
            <span class="font-medium text-zinc-100">{{ labelOf(key) }}</span>
            <span class="text-zinc-500"> · {{ status.progress[key]?.phase || 'Working…' }}</span>
          </span>
          <span class="text-zinc-500 tabular-nums shrink-0">
            <template v-if="progressPct(status.progress[key]) != null">
              {{ status.progress[key]!.done.toLocaleString() }} / {{ status.progress[key]!.total!.toLocaleString() }}
              ({{ progressPct(status.progress[key]) }}%)
            </template>
            <template v-if="status.progress[key]"> · {{ elapsed(status.progress[key]!.startedAt) }}</template>
          </span>
        </div>
        <div class="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            v-if="progressPct(status.progress[key]) != null"
            class="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            :style="{ width: `${progressPct(status.progress[key])}%` }"
          />
          <div v-else class="h-full w-1/3 rounded-full bg-accent/70 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
        </div>
      </div>
      <p v-if="status.queued.length" class="text-xs text-zinc-500">
        Queued next: {{ status.queued.map(labelOf).join(', ') }}
      </p>
    </div>

    <!-- ============================================================ Importers -->
    <div v-if="view === 'sources'" class="space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <p class="text-xs text-zinc-500">Re-running an import never creates duplicates.</p>
        <button
          type="button"
          :disabled="totalUnaccepted === 0"
          class="btn btn-sm btn-danger"
          @click="clearAllPending"
        >Clear all unaccepted<span v-if="totalUnaccepted" class="tabular-nums">({{ totalUnaccepted.toLocaleString() }})</span></button>
      </div>

      <section v-for="g in IMPORT_GROUPS" :key="g.heading" class="card overflow-hidden">
        <header class="flex items-baseline gap-2 px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/40">
          <h2 class="text-sm font-semibold text-zinc-100">{{ g.heading }}</h2>
          <span v-if="g.note" class="text-xs text-zinc-500 truncate">{{ g.note }}</span>
          <span v-if="groupUnaccepted(g)" class="ml-auto shrink-0 text-xs text-sky-300 tabular-nums">{{ groupUnaccepted(g).toLocaleString() }} unaccepted</span>
        </header>
        <ul class="divide-y divide-zinc-800/60">
          <li v-for="src in g.sources" :key="src.key" class="flex items-center gap-3 px-4 py-2.5">
            <span class="flex-1 min-w-0">
              <span class="flex items-center gap-2">
                <a
                  v-if="src.href"
                  :href="src.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm font-medium text-zinc-100 hover:text-accent truncate"
                  :title="`Open ${src.label}`"
                >{{ src.label }} <span class="text-[10px] text-zinc-600">↗</span></a>
                <span v-else class="text-sm font-medium text-zinc-100 truncate">{{ src.label }}</span>
                <span v-if="status.running.includes(src.key)" class="text-[11px] font-medium text-amber-300 shrink-0">Running</span>
                <span v-else-if="status.queued.includes(src.key)" class="text-[11px] font-medium text-sky-300 shrink-0">Queued</span>
              </span>
              <span v-if="src.blurb" class="block text-xs text-zinc-500 truncate">{{ src.blurb }}</span>
            </span>
            <span class="hidden sm:block w-28 text-right text-xs tabular-nums" :class="unaccepted(src) ? 'text-sky-300' : 'text-zinc-600'">
              <template v-if="src.pendingKey">{{ unaccepted(src).toLocaleString() }} unaccepted</template>
            </span>
            <span class="flex items-center gap-1.5 shrink-0">
              <button
                v-if="src.pendingKey"
                type="button"
                :disabled="!unaccepted(src)"
                class="btn btn-sm btn-ghost hover:border-red-700 hover:text-red-300"
                :title="`Delete ${src.label}’s unaccepted levels`"
                @click="clearPending(src)"
              >Clear</button>
              <button
                type="button"
                :disabled="busy[src.key] || status.queued.includes(src.key)"
                class="btn btn-sm w-[5.5rem]"
                :class="status.running.includes(src.key) ? 'btn-ghost' : 'btn-primary'"
                @click="runImport(src)"
              >{{ status.queued.includes(src.key) ? 'Queued' : status.running.includes(src.key) ? 'Queue again' : 'Run' }}</button>
            </span>
          </li>
        </ul>
      </section>
    </div>

    <!-- ============================================================ Placements -->
    <div v-else-if="view === 'placements'" class="space-y-4">
      <section class="card p-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-zinc-100">Back up the order</h2>
            <p class="text-xs text-zinc-500 mt-1 max-w-lg">
              The list’s order as a file. Download one before anything risky. Edit the CSV in a spreadsheet to move specific levels.
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button type="button" :disabled="!!snapshotBusy" class="btn btn-sm btn-primary" @click="downloadPlacements('json')">
              {{ snapshotBusy === 'json' ? 'Building…' : 'Download JSON' }}
            </button>
            <button type="button" :disabled="!!snapshotBusy" class="btn btn-sm btn-ghost" title="Editable in a spreadsheet" @click="downloadPlacements('csv')">
              {{ snapshotBusy === 'csv' ? 'Building…' : 'Download CSV' }}
            </button>
          </div>
        </div>
      </section>

      <section class="card p-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-zinc-100">Restore from a file</h2>
            <p class="text-xs text-zinc-500 mt-1 max-w-lg">Pick a backup. You see what would move before anything does.</p>
          </div>
          <label class="btn btn-sm btn-ghost cursor-pointer shrink-0">
            {{ restoreBusy ? 'Reading…' : 'Choose a file…' }}
            <input
              ref="restoreInput"
              type="file"
              accept=".json,.csv,application/json,text/csv,text/plain"
              class="hidden"
              @change="pickRestoreFile"
            />
          </label>
        </div>
        <div v-if="restorePreview" class="mt-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <p class="text-xs text-zinc-300">
            <span class="text-zinc-500">{{ restoreName }}</span> ·
            <span class="tabular-nums text-zinc-100">{{ restorePreview.matched.toLocaleString() }}</span> matched,
            <span class="tabular-nums" :class="restorePreview.unmatched ? 'text-amber-300' : 'text-zinc-500'">{{ restorePreview.unmatched.toLocaleString() }}</span> unmatched,
            <span class="tabular-nums text-zinc-100">{{ restorePreview.moved.toLocaleString() }}</span> would move.
          </p>
          <p v-if="restorePreview.untouched_extra > 0" class="text-[11px] text-zinc-500 mt-1">
            {{ restorePreview.untouched_extra.toLocaleString() }} levels here aren’t in the file and stay where they are.
          </p>
          <p v-if="restorePreview.retiered" class="text-[11px] text-zinc-500 mt-1">
            {{ restorePreview.retiered.toLocaleString() }} levels also get their tier back.
          </p>
          <ul v-if="restorePreview.sample.length" class="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
            <li v-for="m in restorePreview.sample" :key="m.level_id" class="text-[11px] flex gap-2">
              <span class="tabular-nums text-zinc-500 shrink-0">#{{ m.from_position.toLocaleString() }} → #{{ m.to_position.toLocaleString() }}</span>
              <span class="truncate text-zinc-300">{{ m.name }}</span>
            </li>
          </ul>
          <button
            type="button"
            :disabled="restoreBusy || (restorePreview.moved === 0 && !restorePreview.retiered)"
            class="btn btn-sm btn-primary mt-3"
            @click="applyRestore"
          >
            <template v-if="restorePreview.moved === 0 && !restorePreview.retiered">Nothing to restore</template>
            <template v-else-if="restorePreview.moved === 0">Restore {{ restorePreview.retiered!.toLocaleString() }} tiers</template>
            <template v-else>Restore {{ restorePreview.moved.toLocaleString() }} placements</template>
          </button>
        </div>
      </section>

      <section class="card p-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-zinc-100">Reset to the sheet’s order</h2>
            <p class="text-xs text-zinc-500 mt-1 max-w-lg">
              Undo every move made here and put sheet-backed levels back in the sheet’s order. Site-only levels keep their places.
            </p>
          </div>
          <button type="button" :disabled="resetBusy" class="btn btn-sm btn-ghost shrink-0" @click="sheetReset(false)">
            {{ resetBusy ? 'Checking…' : 'Preview' }}
          </button>
        </div>
        <div v-if="resetPreview" class="mt-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <p class="text-xs text-zinc-300">
            <span class="tabular-nums text-zinc-100">{{ resetPreview.moved.toLocaleString() }}</span>
            of {{ resetPreview.matched.toLocaleString() }} sheet-backed levels would move.
            <span class="text-zinc-500">{{ resetPreview.untouched_extra.toLocaleString() }} stay put.</span>
          </p>
          <ul v-if="resetPreview.sample.length" class="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
            <li v-for="m in resetPreview.sample" :key="m.level_id" class="text-[11px] flex gap-2">
              <span class="tabular-nums text-zinc-500 shrink-0">#{{ m.from_position.toLocaleString() }} → #{{ m.to_position.toLocaleString() }}</span>
              <span class="truncate text-zinc-300">{{ m.name }}</span>
            </li>
          </ul>
          <button
            type="button"
            :disabled="resetBusy || resetPreview.moved === 0"
            class="btn btn-sm btn-danger mt-3"
            @click="applySheetReset"
          >{{ resetPreview.moved === 0 ? 'Already in sheet order' : `Reset ${resetPreview.moved.toLocaleString()} placements` }}</button>
        </div>
      </section>

      <section v-if="handover && handover.total > 0" class="card p-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-zinc-100">Levels stored here, not on the sheet</h2>
            <p class="text-xs text-zinc-500 mt-1 max-w-lg">
              Promoted submissions and hand-placed additions. Once the sheet has one, hand it over: the sheet’s data replaces the copy here and the importer keeps it updated.
            </p>
            <p class="text-[11px] text-zinc-500 mt-1.5 tabular-nums">
              {{ handover.total.toLocaleString() }} site-owned · {{ handover.matched.toLocaleString() }} already on the sheet
            </p>
          </div>
          <button
            type="button"
            :disabled="handoverBusy != null || handover.matched === 0"
            class="btn btn-sm btn-primary shrink-0"
            @click="handOver('all')"
          >{{ handoverBusy === 'all' ? 'Handing over…' : `Hand over ${handover.matched.toLocaleString()}` }}</button>
        </div>
        <ul class="mt-3 divide-y divide-zinc-800/60 max-h-72 overflow-y-auto rounded-md border border-zinc-800">
          <li v-for="h in handover.items" :key="h.level_id" class="flex items-center gap-3 px-3 py-2">
            <NuxtLink :to="`/levels/${h.position}`" class="text-xs text-zinc-200 hover:text-accent truncate flex-1">
              {{ h.name }} <span class="text-zinc-600">#{{ h.position.toLocaleString() }}</span>
            </NuxtLink>
            <Badge :tone="h.reason === 'site_only' ? 'amber' : 'violet'" size="sm">
              {{ h.reason === 'site_only' ? 'site only' : h.reason === 'both' ? 'both' : 'permanent' }}
            </Badge>
            <span v-if="h.sheet" class="shrink-0 text-[11px] text-emerald-400 tabular-nums">sheet #{{ h.sheet.sheet_placement ?? '?' }}</span>
            <span v-else class="shrink-0 text-[11px] text-zinc-600">not on the sheet</span>
            <button
              type="button"
              :disabled="handoverBusy != null || !h.sheet"
              class="btn btn-sm btn-ghost shrink-0"
              @click="handOver(h.level_id)"
            >{{ handoverBusy === h.level_id ? '…' : 'Hand over' }}</button>
          </li>
        </ul>
      </section>

      <section class="card p-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-zinc-100">Repair placements</h2>
            <p class="text-xs text-zinc-500 mt-1 max-w-lg">
              Fixes placement numbers so they climb in list order. Runs by itself at boot and after every move. Safe any time.
            </p>
          </div>
          <button type="button" :disabled="repairing" class="btn btn-sm btn-ghost shrink-0" @click="repairPlacements">
            {{ repairing ? 'Repairing…' : 'Repair now' }}
          </button>
        </div>
      </section>
    </div>

    <!-- ============================================================ Report -->
    <div v-else class="space-y-4">
      <section class="card p-4">
        <h2 class="text-sm font-semibold text-zinc-100">Sheet vs. site</h2>
        <p class="text-xs text-zinc-500 mt-1 max-w-lg">Everywhere the ALL sheet and this site disagree, as a file.</p>
        <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div class="rounded-md border border-zinc-800 p-3">
            <dt class="font-medium text-zinc-200">Drift points</dt>
            <dd class="text-zinc-500 mt-0.5">Where the sheet’s numbering and the site’s order move apart, and by how much.</dd>
          </div>
          <div class="rounded-md border border-zinc-800 p-3">
            <dt class="font-medium text-zinc-200">Site-only levels</dt>
            <dd class="text-zinc-500 mt-0.5">Levels the sheet doesn’t have.</dd>
          </div>
          <div class="rounded-md border border-zinc-800 p-3">
            <dt class="font-medium text-zinc-200">Sheet-exclusive rows</dt>
            <dd class="text-zinc-500 mt-0.5">Sheet rows with no level here, with the sheet’s own data.</dd>
          </div>
        </dl>
        <div class="mt-4 flex items-center gap-2 flex-wrap">
          <button type="button" :disabled="!!reportBusy" class="btn btn-sm btn-primary" @click="downloadReport('json')">
            {{ reportBusy === 'json' ? 'Building…' : 'Download report' }}
          </button>
          <button type="button" :disabled="!!reportBusy" class="btn btn-sm btn-ghost" title="Drift points as a spreadsheet" @click="downloadReport('csv')">
            {{ reportBusy === 'csv' ? 'Building…' : 'Drift points (CSV)' }}
          </button>
          <button type="button" :disabled="!!reportBusy" class="btn btn-sm btn-ghost text-zinc-400" title="Every level whose sheet number differs. A large file." @click="downloadReport('full')">
            {{ reportBusy === 'full' ? 'Building…' : 'Every level (large)' }}
          </button>
        </div>
        <p v-if="reportSummary" class="mt-3 text-xs text-emerald-400">{{ reportSummary }}</p>
      </section>
    </div>
  </AdminSection>
</template>

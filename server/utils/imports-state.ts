// In-memory tracker for which import sources are currently running or queued,
// so the admin imports tab can render indicators and the run endpoint can
// queue a follow-up run instead of rejecting when one is already in flight.
//
// Cleared on server restart, which is fine: a long-running import dies with
// the process anyway.

const running = new Set<string>()
const queued = new Set<string>()

/**
 * How far along a running import is.
 *
 * Importers already narrate themselves to the console — "fetching level
 * list…", "3200/4108 processed" — and none of that reached the admin who
 * pressed the button, who got a pulsing "Running" chip for anything from ten
 * seconds to ten minutes with no way to tell the difference between working and
 * wedged. `phase` is the sentence; `done`/`total` are the bar.
 *
 * `total` is null while a phase can't count itself (a fetch that hasn't
 * returned yet), which the UI renders as an indeterminate bar rather than
 * pretending to a percentage it doesn't have.
 */
export type ImportProgress = {
  phase: string
  done: number
  total: number | null
  startedAt: number
  updatedAt: number
}

/**
 * How an importer says where it has got to.
 *
 * Passed in rather than looked up, because several sources can be importing at
 * once and a module-level "current import" would attribute one's progress to
 * another. Optional everywhere: the same importers run standalone from the CLI,
 * where nobody is watching.
 */
export type ProgressReporter = (patch: { phase?: string; done?: number; total?: number | null }) => void

const progress = new Map<string, ImportProgress>()

export function isImportRunning(source: string): boolean {
  return running.has(source)
}
export function getImportRunningSet(): ReadonlySet<string> {
  return running
}
export function isImportQueued(source: string): boolean {
  return queued.has(source)
}
export function getImportQueuedSet(): ReadonlySet<string> {
  return queued
}
export function startImport(source: string): boolean {
  if (running.has(source)) return false
  running.add(source)
  progress.set(source, {
    phase: 'Starting…', done: 0, total: null,
    startedAt: Date.now(), updatedAt: Date.now(),
  })
  return true
}
export function finishImport(source: string): void {
  running.delete(source)
  progress.delete(source)
}
export function queueImport(source: string): boolean {
  if (queued.has(source)) return false
  queued.add(source)
  return true
}
export function dequeueImport(source: string): boolean {
  return queued.delete(source)
}

/**
 * Report where an import has got to. Safe to call from anywhere, including
 * importers run standalone from the CLI, where nothing is watching and this is
 * a no-op on a map nobody reads.
 */
export function setImportProgress(
  source: string,
  patch: { phase?: string; done?: number; total?: number | null },
): void {
  const prev = progress.get(source)
  const now = Date.now()
  progress.set(source, {
    phase: patch.phase ?? prev?.phase ?? '',
    // A new phase resets the count unless it brings its own, so a bar never
    // carries the previous phase's numbers into this one.
    done: patch.done ?? (patch.phase && patch.phase !== prev?.phase ? 0 : prev?.done ?? 0),
    total: patch.total !== undefined
      ? patch.total
      : (patch.phase && patch.phase !== prev?.phase ? null : prev?.total ?? null),
    startedAt: prev?.startedAt ?? now,
    updatedAt: now,
  })
}

export function getImportProgress(source: string): ImportProgress | null {
  return progress.get(source) ?? null
}

export function getAllImportProgress(): Record<string, ImportProgress> {
  return Object.fromEntries(progress)
}

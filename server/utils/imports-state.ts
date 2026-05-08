// In-memory tracker for which import sources are currently running, so the
// admin imports tab can render a "running…" indicator and the run endpoint
// can refuse a duplicate kick-off while one is already in flight.
//
// Cleared on server restart, which is fine: a long-running import dies with
// the process anyway.

const running = new Set<string>()

export function isImportRunning(source: string): boolean {
  return running.has(source)
}
export function getImportRunningSet(): ReadonlySet<string> {
  return running
}
export function startImport(source: string): boolean {
  if (running.has(source)) return false
  running.add(source)
  return true
}
export function finishImport(source: string): void {
  running.delete(source)
}

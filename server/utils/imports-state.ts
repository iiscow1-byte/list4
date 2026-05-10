// In-memory tracker for which import sources are currently running or queued,
// so the admin imports tab can render indicators and the run endpoint can
// queue a follow-up run instead of rejecting when one is already in flight.
//
// Cleared on server restart, which is fine: a long-running import dies with
// the process anyway.

const running = new Set<string>()
const queued = new Set<string>()

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
  return true
}
export function finishImport(source: string): void {
  running.delete(source)
}
export function queueImport(source: string): boolean {
  if (queued.has(source)) return false
  queued.add(source)
  return true
}
export function dequeueImport(source: string): boolean {
  return queued.delete(source)
}

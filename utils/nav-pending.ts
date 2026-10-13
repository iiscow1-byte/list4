/**
 * Whether a route change is in flight, kept by `plugins/nav-pending.client.ts`.
 * Only ever set in the browser; on the server nothing is pending.
 */
let pending = false
let waiters: (() => void)[] = []

export function markNavigation(isPending: boolean): void {
  pending = isPending
  if (!isPending) {
    const done = waiters
    waiters = []
    for (const w of done) w()
  }
}

/** Resolves once no route change is in flight. */
export function navigationSettled(): Promise<void> {
  return pending ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve()
}

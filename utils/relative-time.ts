/**
 * "3m", "5h", "2d", then a date.
 *
 * The same function had been hand-written inside `community.vue`, `leaderboard.vue`
 * and `clans/index.vue`, each with its own thresholds — so the same timestamp
 * read differently depending on which page you were on. This is that function,
 * once.
 *
 * ## The timestamp format
 *
 * SQLite's `datetime('now')` returns `YYYY-MM-DD HH:MM:SS` with no zone marker,
 * and it is UTC. `Date.parse` reads a bare string like that as *local* time,
 * which on a UTC+2 machine makes every fresh row two hours in the future and
 * prints "just now" for the next two hours. Normalising to an ISO string with
 * an explicit `Z` is what fixes that, and is why this can't simply be
 * `new Date(at)`.
 */
export function relativeTime(at: string | null | undefined): string {
  if (!at) return ''
  const iso = at.includes('T') ? at : `${at.replace(' ', 'T')}Z`
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''

  // Clamped at zero: a row written a moment ago by a clock a second ahead of
  // this one should read "just now", not "in 1 second".
  const secs = Math.max(0, (Date.now() - t) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`
  const days = Math.floor(secs / 86_400)
  if (days < 30) return `${days}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** The full timestamp, for a `title=` beside the short one. */
export function absoluteTime(at: string | null | undefined): string {
  if (!at) return ''
  const iso = at.includes('T') ? at : `${at.replace(' ', 'T')}Z`
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleString()
}

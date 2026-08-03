/**
 * Links out to gdbrowser, the public front end for RobTop's servers.
 *
 * Every level ID and every Geometry Dash username on this site should be
 * clickable and should land in the same place. That was six copies of the same
 * one-line template, plus a handful of spots where the ID was rendered as plain
 * text and simply didn't go anywhere.
 */

const GDBROWSER = 'https://gdbrowser.com'

/** The level's page on gdbrowser. Null when there's no ID to point at. */
export function gdLevelUrl(gdId: number | string | null | undefined): string | null {
  if (gdId == null || gdId === '') return null
  const n = Number(gdId)
  if (!Number.isInteger(n) || n <= 0) return null
  return `${GDBROWSER}/${n}`
}

/**
 * A player's profile on gdbrowser.
 *
 * Usernames are 1–20 characters of the set RobTop's servers accept; anything
 * else is a typo or a paste of something that isn't a username, and returning
 * null keeps a broken link off the page rather than shipping a 404.
 */
const USERNAME_RE = /^[A-Za-z0-9 _.-]{1,20}$/

export function isGdUsername(name: string | null | undefined): boolean {
  return typeof name === 'string' && USERNAME_RE.test(name.trim()) && name.trim().length > 0
}

export function gdUserUrl(name: string | null | undefined): string | null {
  const s = (name ?? '').trim()
  if (!isGdUsername(s)) return null
  return `${GDBROWSER}/u/${encodeURIComponent(s)}`
}

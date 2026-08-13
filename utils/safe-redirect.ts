/**
 * Where a `?next=` is allowed to send somebody.
 *
 * `router.push(route.query.next)` is an open redirect, and an open redirect on
 * a *login* page is the useful kind: a link carrying the real domain that lands
 * on an attacker's copy of the login form the moment you sign in. People check
 * the domain before typing a password, not after.
 *
 * The rule is "a path on this site", and it takes several checks rather than
 * one because there are several ways to leave:
 *
 *   - `https://evil.example` - absolute, obviously.
 *   - `//evil.example` - protocol-relative. Starts with a slash, so a naive
 *     "must start with /" test passes it, and the browser reads it as a host.
 *   - A backslash anywhere, which several browsers normalise to a forward
 *     slash *after* a check like this has already run.
 *   - `/javascript:...` - not a route; a scheme cannot appear in a path.
 *   - Any control character, which can terminate parsing in one layer and not
 *     the next.
 *
 * Anything that fails falls back rather than throwing: a bad `next` is nearly
 * always a mangled link rather than an attack, and the person still wants to be
 * signed in.
 */
const FALLBACK = '/account'

/**
 * One backslash, built from its code point.
 *
 * A literal one in the source survives being written and read by a dozen tools
 * only if every one of them agrees about escaping, and this file has already
 * been mangled once by that. `92` cannot be misread.
 */
const BACKSLASH = String.fromCharCode(92)

/**
 * Control characters, by code point rather than by regex.
 *
 * A character class typed by hand here is unreviewable - the characters are
 * invisible in a source file - and one written as `[<space>-<hyphen>]` would
 * silently reject `/open-verifications` and every other route with a dash in
 * it. Comparing code points says exactly what it means and cannot be mangled
 * by an editor.
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function safeNext(value: unknown, fallback = FALLBACK): string {
  if (typeof value !== 'string') return fallback
  const next = value.trim()
  if (!next) return fallback

  if (!next.startsWith('/')) return fallback
  if (next.startsWith('//')) return fallback
  if (next.includes(BACKSLASH)) return fallback
  if (/^[/]+[a-z][a-z0-9+.-]*:/i.test(next)) return fallback
  if (hasControlChar(next)) return fallback

  return next
}

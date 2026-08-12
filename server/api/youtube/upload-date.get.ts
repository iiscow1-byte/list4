import { requireAccount } from '~/server/utils/auth'

/**
 * Upload dates for verification videos.
 *
 * `?id=` answers for one video; `?ids=a,b,c` answers for up to 50 in a single
 * call, because the YouTube API charges per request rather than per video.
 * Submitting a whole custom list to the ALL asks about dozens of videos at
 * once, and one request per row would spend the daily quota on a single list.
 *
 * A video that can't be resolved is simply absent from `dates` rather than an
 * error — a missing date is something the submitter can still type.
 *
 * ## The key
 *
 * Three things keep it out of harm's way, and the first is the one that
 * actually mattered:
 *
 * - **It is sent as an `X-goog-api-key` header, not in the query string.** A
 *   key in a URL leaks everywhere a URL goes: request logs, proxy logs, error
 *   messages that echo the URL back. This file used to interpolate it into the
 *   URL *and* `console.error` around the same call, which is one unlucky error
 *   shape away from printing the key into the server log.
 * - **It never leaves the server.** `process.env` inside `server/` is not
 *   bundled for the browser, and the answer this endpoint returns contains only
 *   dates.
 * - **The endpoint needs a session.** It is a proxy onto a metered third-party
 *   quota, and every caller — the submit form, the review queue, the custom-list
 *   hand-off, the level page's admin autofill — is already behind a login.
 *   Without this, one script could spend the day's quota from the open web.
 *
 * `configured` tells the client the difference between "no key" and "no date",
 * which the caller could not previously distinguish: a missing key silently
 * returned empty results, so the feature looked like it was working and finding
 * nothing.
 */
const MAX_IDS = 50
const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/

/**
 * Upload dates never change, so a resolved one is good forever.
 *
 * This is the difference between hand-checking a 200-level custom list costing
 * four API calls and costing four every time somebody reloads the page. Bounded
 * because the process is long-lived; the eviction is crude on purpose — losing
 * an entry costs one API call, not correctness.
 */
const CACHE_MAX = 5000
const cache = new Map<string, string | null>()

function remember(id: string, date: string | null): void {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest quarter rather than one entry, so this runs rarely.
    let n = Math.floor(CACHE_MAX / 4)
    for (const k of cache.keys()) {
      cache.delete(k)
      if (--n <= 0) break
    }
  }
  cache.set(id, date)
}

export default defineEventHandler(async (event) => {
  // A metered upstream: signed-in callers only. Every UI that asks is already
  // behind a login, so this costs nothing the site was using.
  requireAccount(event)

  const query = getQuery(event)
  const single = String(query.id ?? '').trim()
  const batch = String(query.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const ids = [...new Set([...(single ? [single] : []), ...batch])].filter((v) => VIDEO_ID.test(v))
  if (!ids.length) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }
  if (ids.length > MAX_IDS) {
    throw createError({ statusCode: 400, statusMessage: `At most ${MAX_IDS} videos per request.` })
  }

  const dates: Record<string, string> = {}
  const ask: string[] = []
  for (const id of ids) {
    const hit = cache.get(id)
    if (hit === undefined) ask.push(id)
    else if (hit) dates[id] = hit
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim()
  if (!apiKey) {
    // Said once per process rather than per request: a missing key is a
    // deployment fact, not an event, and it was previously shouted into the log
    // on every single lookup.
    warnMissingKey()
    return { date: single ? dates[single] ?? null : null, dates, configured: false }
  }

  if (ask.length) {
    try {
      // The key rides in a header. Nothing secret is ever part of this URL.
      const url = 'https://www.googleapis.com/youtube/v3/videos'
        + `?part=snippet&fields=items(id,snippet/publishedAt)&id=${encodeURIComponent(ask.join(','))}`
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(new Error('Timeout after 8000ms')), 8000)
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'X-goog-api-key': apiKey, accept: 'application/json' },
      }).finally(() => clearTimeout(timer))

      if (!res.ok) {
        // Status only. The body of a Google API error can echo the request back
        // and there is nothing in it worth the risk.
        console.error(`[upload-date] youtube api: HTTP ${res.status}`)
        return { date: single ? dates[single] ?? null : null, dates, configured: true }
      }

      const data = await res.json() as { items?: Array<{ id?: string; snippet?: { publishedAt?: string } }> }
      const seen = new Set<string>()
      for (const item of data?.items ?? []) {
        const publishedAt = item?.snippet?.publishedAt
        if (item?.id && publishedAt && /^\d{4}-\d{2}-\d{2}/.test(publishedAt)) {
          const day = publishedAt.slice(0, 10)
          dates[item.id] = day
          remember(item.id, day)
          seen.add(item.id)
        }
      }
      // A video the API didn't answer for is private, deleted or not a video.
      // Remembering that stops the same dead ID being asked about forever.
      for (const id of ask) if (!seen.has(id)) remember(id, null)
    } catch (e) {
      console.error('[upload-date] youtube api:', (e as Error).message)
      return { date: single ? dates[single] ?? null : null, dates, configured: true }
    }
  }

  return { date: single ? dates[single] ?? null : null, dates, configured: true }
})

let warnedMissing = false
function warnMissingKey(): void {
  if (warnedMissing) return
  warnedMissing = true
  console.error(
    '[upload-date] YOUTUBE_API_KEY is not set — verification dates will stay blank. '
    + 'Copy .env.example to .env and fill it in.',
  )
}

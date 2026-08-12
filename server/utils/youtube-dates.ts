import { youtubeIdFrom } from '~/utils/level-thumbs'

/**
 * Upload dates for YouTube videos, as a server-side function.
 *
 * This logic used to live entirely inside `/api/youtube/upload-date`, which
 * meant only a browser could use it. Everything that needed a verification
 * date therefore *asked the client to go and get one first* — and a submission
 * whose client hadn't (or couldn't) was rejected with "needs a verification
 * date" even though the date was one API call away and the link was right
 * there. Pulling it out means a server-side handler can fill the gap itself.
 *
 * The endpoint is now a thin wrapper over this, so both paths share one cache
 * and one quota.
 *
 * ## The key
 *
 * Sent as an `X-goog-api-key` header, never in the URL: a key in a URL leaks
 * into request logs, proxy logs, and any error message that echoes the URL
 * back. `process.env` inside `server/` is never bundled for the browser.
 */

const MAX_IDS = 50
const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/
const TIMEOUT_MS = 8000

/**
 * Upload dates never change, so a resolved one is good forever.
 *
 * This is the difference between hand-checking a 200-level custom list costing
 * four API calls and costing four every time somebody reloads the page. Bounded
 * because the process is long-lived; the eviction is crude on purpose — losing
 * an entry costs one API call, not correctness.
 *
 * A `null` entry is a remembered miss: private, deleted, or not a video. Worth
 * caching precisely so a dead ID isn't asked about forever.
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

export function isYoutubeConfigured(): boolean {
  return !!process.env.YOUTUBE_API_KEY?.trim()
}

let warnedMissing = false
function warnMissingKey(): void {
  if (warnedMissing) return
  warnedMissing = true
  console.error(
    '[upload-date] YOUTUBE_API_KEY is not set — verification dates will stay blank. '
    + 'Copy .env.example to .env and fill it in.',
  )
}

export type UploadDateResult = {
  /** id → `YYYY-MM-DD`. A video with no answer is simply absent. */
  dates: Record<string, string>
  /** False when the server has no API key at all — a deployment fact, not a miss. */
  configured: boolean
}

/**
 * Resolve upload dates for up to 50 video IDs in one API call.
 *
 * Ids that aren't plausible video IDs are dropped rather than rejected: callers
 * hand this whatever they scraped out of a URL field, and one bad row should
 * not cost the other forty-nine their dates.
 */
export async function fetchUploadDates(rawIds: string[]): Promise<UploadDateResult> {
  const ids = [...new Set(rawIds.map((s) => String(s ?? '').trim()).filter(Boolean))]
    .filter((v) => VIDEO_ID.test(v))
    .slice(0, MAX_IDS)

  const dates: Record<string, string> = {}
  if (!ids.length) return { dates, configured: isYoutubeConfigured() }

  const ask: string[] = []
  for (const id of ids) {
    const hit = cache.get(id)
    if (hit === undefined) ask.push(id)
    else if (hit) dates[id] = hit
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim()
  if (!apiKey) {
    // Said once per process rather than per request: a missing key is a
    // deployment fact, not an event.
    warnMissingKey()
    return { dates, configured: false }
  }
  if (!ask.length) return { dates, configured: true }

  try {
    // The key rides in a header. Nothing secret is ever part of this URL.
    const url = 'https://www.googleapis.com/youtube/v3/videos'
      + `?part=snippet&fields=items(id,snippet/publishedAt)&id=${encodeURIComponent(ask.join(','))}`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error(`Timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'X-goog-api-key': apiKey, accept: 'application/json' },
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      // Status only. The body of a Google API error can echo the request back
      // and there is nothing in it worth the risk.
      console.error(`[upload-date] youtube api: HTTP ${res.status}`)
      return { dates, configured: true }
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
    for (const id of ask) if (!seen.has(id)) remember(id, null)
  } catch (e) {
    console.error('[upload-date] youtube api:', (e as Error).message)
  }

  return { dates, configured: true }
}

/**
 * Upload dates keyed by the *video URL* they came from, in chunks of 50.
 *
 * What a submission handler actually has is a column of `verification_url`
 * strings, so this does the extraction and the chunking that every caller would
 * otherwise repeat. URLs that aren't YouTube — or aren't videos — are simply
 * absent from the result, which is the same shape as "no date found" and wants
 * the same handling.
 */
export async function uploadDatesForUrls(
  urls: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const byId = new Map<string, string[]>()
  for (const url of urls) {
    const id = youtubeIdFrom(url)
    if (!id) continue
    const bucket = byId.get(id)
    if (bucket) bucket.push(url as string)
    else byId.set(id, [url as string])
  }
  const out = new Map<string, string>()
  if (!byId.size) return out

  const ids = [...byId.keys()]
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const slice = ids.slice(i, i + MAX_IDS)
    const { dates } = await fetchUploadDates(slice)
    for (const id of slice) {
      const date = dates[id]
      if (!date) continue
      for (const url of byId.get(id) ?? []) out.set(url, date)
    }
  }
  return out
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }

  // Strategy 1: Piped API — a public open-source YouTube proxy whose endpoints
  // are designed to be called programmatically. Not subject to YouTube's
  // datacenter-IP blocking. Try multiple public instances in order.
  const pipedBases = [
    'https://pipedapi.kavin.rocks',
    'https://piped-api.garudalinux.org',
    'https://api.piped.projectsegfau.lt',
  ]
  for (const base of pipedBases) {
    try {
      const res = await fetchTimeout(`${base}/streams/${id}`, {
        headers: { 'User-Agent': 'AllLevelsList/1.0' },
      }, 5000)
      if (res.ok) {
        const data = await res.json() as any
        const raw = data?.uploadDate
        if (raw && /^\d{4}-\d{2}-\d{2}/.test(String(raw))) {
          return { date: String(raw).slice(0, 10) }
        }
        // Got a valid response but no date — video might be private/deleted.
        // No point trying other Piped instances; fall through to scraping.
        console.error(`[upload-date] piped ${base}: no uploadDate (error="${data?.error ?? ''}")`)
        break
      }
      console.error(`[upload-date] piped ${base}: HTTP ${res.status}`)
    } catch (e) {
      console.error(`[upload-date] piped ${base}:`, (e as Error).message)
    }
  }

  // Strategy 2: scrape the YouTube watch page directly. May fail on server IPs
  // that YouTube blocks, but worth trying as a fast fallback.
  try {
    const res = await fetchTimeout(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    }, 5000)
    if (res.ok) {
      const html = await res.text()
      const date = extractPublishDate(html)
      if (date) return { date }
      console.error(`[upload-date] watch page: no date in ${html.length}-byte response`)
    } else {
      console.error(`[upload-date] watch page: HTTP ${res.status}`)
    }
  } catch (e) {
    console.error(`[upload-date] watch page:`, (e as Error).message)
  }

  return { date: null }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// AbortController-based timeout that works across all Node/Nitro runtimes.
// AbortSignal.timeout() is not reliably available in all deployment targets.
function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`Timeout after ${ms}ms`)), ms)
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer))
}

function extractPublishDate(html: string): string | null {
  // Primary: parse ytInitialPlayerResponse from an inline <script> tag.
  const scriptTagRe = /<script[^>]*>([\s\S]*?)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = scriptTagRe.exec(html)) !== null) {
    const sc = m[1]
    if (!sc.includes('ytInitialPlayerResponse')) continue
    const markerIdx = sc.indexOf('ytInitialPlayerResponse')
    const jsonStart = sc.indexOf('{', markerIdx)
    if (jsonStart === -1) continue
    const jsonStr = extractJsonObject(sc, jsonStart)
    if (!jsonStr) continue
    try {
      const data = JSON.parse(jsonStr)
      const date: string | undefined =
        data?.microformat?.playerMicroformatRenderer?.publishDate
        ?? data?.microformat?.playerMicroformatRenderer?.uploadDate
      if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10)
    } catch { /* fall through to regex */ }
  }

  // Fallback: direct regex search for date patterns in the raw HTML.
  const patterns = [
    /"publishDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/,
    /"uploadDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/,
    /"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/,
    /itemprop="datePublished"\s+content="(\d{4}-\d{2}-\d{2})"/,
    /content="(\d{4}-\d{2}-\d{2})"\s+itemprop="(?:datePublished|uploadDate)"/,
  ]
  for (const re of patterns) {
    const match = html.match(re)
    if (match) return match[1]
  }

  return null
}

// Walk character-by-character to find the matching closing brace, correctly
// handling nested objects, arrays, strings, and escape sequences.
function extractJsonObject(str: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < str.length; i++) {
    const c = str[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') { if (--depth === 0) return str.slice(start, i + 1) }
  }
  return null
}

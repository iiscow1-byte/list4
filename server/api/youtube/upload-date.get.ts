export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }

  // Strategy 1: fetch the watch page and extract ytInitialPlayerResponse,
  // following the approach used by https://github.com/iErcann/yt-get-info.
  // No cookies — expired SOCS/CONSENT cookies can cause YouTube to serve a
  // consent page that has no metadata at all.
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      signal: AbortSignal.timeout(7000),
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    })
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

  // Strategy 2: YouTube's internal player API (IOS client context).
  // Kept as a fallback but given a hard 5 s timeout so it never hangs.
  try {
    const res = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
          'X-YouTube-Client-Name': '5',
          'X-YouTube-Client-Version': '19.09.3',
        },
        body: JSON.stringify({
          videoId: id,
          context: {
            client: {
              hl: 'en',
              gl: 'US',
              clientName: 'IOS',
              clientVersion: '19.09.3',
              deviceModel: 'iPhone16,2',
              osName: 'iPhone',
              osVersion: '17.5.1.21F90',
            },
          },
        }),
      },
    )
    if (res.ok) {
      const data = await res.json() as any
      const date: string | undefined =
        data?.microformat?.playerMicroformatRenderer?.publishDate
        ?? data?.microformat?.playerMicroformatRenderer?.uploadDate
      if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) return { date: date.slice(0, 10) }
      console.error(`[upload-date] ios api: no date, playability=${data?.playabilityStatus?.status}`)
    } else {
      console.error(`[upload-date] ios api: HTTP ${res.status}`)
    }
  } catch (e) {
    console.error(`[upload-date] ios api:`, (e as Error).message)
  }

  return { date: null }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPublishDate(html: string): string | null {
  // Primary: parse ytInitialPlayerResponse from an inline <script> tag
  // (same data source that yt-get-info uses).
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

// Walk the string character-by-character to find the matching closing brace,
// correctly handling nested objects, arrays, strings, and escape sequences.
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

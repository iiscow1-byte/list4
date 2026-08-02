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
 */
const MAX_IDS = 50
const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/

export default defineEventHandler(async (event) => {
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

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    console.error('[upload-date] YOUTUBE_API_KEY is not set')
    return { date: null, dates: {} }
  }

  const dates: Record<string, string> = {}
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(ids.join(','))}&key=${encodeURIComponent(apiKey)}`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('Timeout after 8000ms')), 8000)
    const res = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) {
      console.error(`[upload-date] youtube api: HTTP ${res.status}`)
      return { date: null, dates: {} }
    }
    const data = await res.json() as { items?: Array<{ id?: string; snippet?: { publishedAt?: string } }> }
    for (const item of data?.items ?? []) {
      const publishedAt = item?.snippet?.publishedAt
      if (item?.id && publishedAt && /^\d{4}-\d{2}-\d{2}/.test(publishedAt)) {
        dates[item.id] = publishedAt.slice(0, 10)
      }
    }
  } catch (e) {
    console.error('[upload-date] youtube api:', (e as Error).message)
    return { date: null, dates: {} }
  }

  return { date: single ? dates[single] ?? null : null, dates }
})

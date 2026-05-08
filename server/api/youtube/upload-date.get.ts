export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    console.error('[upload-date] YOUTUBE_API_KEY is not set')
    return { date: null }
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(apiKey)}`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('Timeout after 5000ms')), 5000)
    const res = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) {
      console.error(`[upload-date] youtube api: HTTP ${res.status}`)
      return { date: null }
    }
    const data = await res.json() as { items?: Array<{ snippet?: { publishedAt?: string } }> }
    const publishedAt = data?.items?.[0]?.snippet?.publishedAt
    if (publishedAt && /^\d{4}-\d{2}-\d{2}/.test(publishedAt)) {
      return { date: publishedAt.slice(0, 10) }
    }
    return { date: null }
  } catch (e) {
    console.error('[upload-date] youtube api:', (e as Error).message)
    return { date: null }
  }
})

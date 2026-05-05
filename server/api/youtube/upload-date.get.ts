export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }

  let html: string
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    html = await res.text()
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach YouTube.' })
  }

  // Try multiple patterns — YouTube embeds dates in different ways
  // depending on the page variant and bot-detection level.
  const patterns = [
    /"publishDate":"(\d{4}-\d{2}-\d{2})/,        // ytInitialData JS object
    /"uploadDate":"(\d{4}-\d{2}-\d{2})/,          // JSON-LD schema
    /"datePublished":"(\d{4}-\d{2}-\d{2})/,       // older pages / microdata JSON
    /itemprop="datePublished"\s+content="(\d{4}-\d{2}-\d{2})"/,
    /content="(\d{4}-\d{2}-\d{2})"\s+itemprop="datePublished"/,
  ]

  for (const re of patterns) {
    const m = html.match(re)
    if (m) return { date: m[1] }
  }

  throw createError({ statusCode: 404, statusMessage: 'Could not determine upload date.' })
})

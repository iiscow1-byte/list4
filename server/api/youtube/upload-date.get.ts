export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }

  // Primary: YouTube's internal player API (used by yt-dlp, ytdl-core, etc.)
  // Returns structured JSON including publishDate without requiring an API key.
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '19.09.37',
      },
      body: JSON.stringify({
        videoId: id,
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
          },
        },
      }),
    })
    if (res.ok) {
      const data = await res.json()
      const date: string | undefined = data?.microformat?.playerMicroformatRenderer?.publishDate
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { date }
      }
    }
  } catch { /* fall through */ }

  // Fallback: scrape the watch page with several regex patterns.
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cookie': 'CONSENT=YES+cb; SOCS=CAISHAgBEhJnd3NfMjAyMzA3MThfMF9SQzIaAmVuIAEaBgiA_LSnBg',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      },
    })
    if (res.ok) {
      const html = await res.text()
      const patterns = [
        /"publishDate":"(\d{4}-\d{2}-\d{2})/,
        /"uploadDate":"(\d{4}-\d{2}-\d{2})/,
        /"datePublished":"(\d{4}-\d{2}-\d{2})/,
        /itemprop="datePublished"\s+content="(\d{4}-\d{2}-\d{2})"/,
        /content="(\d{4}-\d{2}-\d{2})"\s+itemprop="(?:datePublished|uploadDate)"/,
      ]
      for (const re of patterns) {
        const m = html.match(re)
        if (m) return { date: m[1] }
      }
    }
  } catch { /* fall through */ }

  throw createError({ statusCode: 404, statusMessage: 'Could not determine upload date.' })
})

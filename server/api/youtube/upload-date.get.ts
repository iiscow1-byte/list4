export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }

  // Strategy 1: YouTube internal API with IOS client context (avoids bot detection
  // better than ANDROID client; no API key required).
  for (const client of [
    {
      name: 'IOS',
      version: '19.09.3',
      clientNum: '5',
      ua: 'com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
      extra: { deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '17.5.1.21F90' },
    },
    {
      name: 'ANDROID',
      version: '19.09.37',
      clientNum: '3',
      ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
      extra: { androidSdkVersion: 30 },
    },
    {
      name: 'WEB',
      version: '2.20240726.00.00',
      clientNum: '1',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extra: {},
    },
  ]) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.ua,
          'X-YouTube-Client-Name': client.clientNum,
          'X-YouTube-Client-Version': client.version,
          ...(client.name === 'WEB' ? { Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/' } : {}),
        },
        body: JSON.stringify({
          videoId: id,
          context: {
            client: {
              hl: 'en',
              gl: 'US',
              clientName: client.name,
              clientVersion: client.version,
              ...client.extra,
            },
          },
        }),
      })
      if (res.ok) {
        const data = await res.json() as any
        const date: string | undefined = data?.microformat?.playerMicroformatRenderer?.publishDate
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { date }
        // Some clients return a different date path
        const date2: string | undefined = data?.videoDetails?.publishDate
        if (date2 && /^\d{4}-\d{2}-\d{2}$/.test(date2)) return { date: date2 }
      }
    } catch { /* try next client */ }
  }

  // Strategy 2: scrape the watch page.
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Cookie: 'CONSENT=YES+cb; SOCS=CAISHAgBEhJnd3NfMjAyMzA3MThfMF9SQzIaAmVuIAEaBgiA_LSnBg',
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

  // Return null date rather than throwing so the client can handle it gracefully.
  return { date: null }
})

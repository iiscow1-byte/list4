export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = String(query.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }

  // Try YouTube's internal player API with multiple client contexts.
  // API keys are the well-known public keys hardcoded in YouTube's own clients
  // (same keys used by yt-dlp and other open-source tools).
  const clients = [
    {
      name: 'IOS',
      version: '19.09.3',
      key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
      clientNum: '5',
      ua: 'com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
      extra: { deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '17.5.1.21F90' },
      extraHeaders: {} as Record<string, string>,
    },
    {
      name: 'ANDROID',
      version: '19.09.37',
      key: 'AIzaSyA8eiZmM1La6DXbBklmaxBGIy0x5C1E9Ik',
      clientNum: '3',
      ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
      extra: { androidSdkVersion: 30 },
      extraHeaders: {} as Record<string, string>,
    },
    {
      name: 'WEB',
      version: '2.20240726.00.00',
      key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientNum: '1',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extra: {},
      extraHeaders: { Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/' } as Record<string, string>,
    },
  ]

  for (const client of clients) {
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${client.key}&prettyPrint=false`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': client.ua,
            'X-YouTube-Client-Name': client.clientNum,
            'X-YouTube-Client-Version': client.version,
            ...client.extraHeaders,
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
        },
      )
      if (res.ok) {
        const data = await res.json() as any
        const date: string | undefined =
          data?.microformat?.playerMicroformatRenderer?.publishDate
          ?? data?.videoDetails?.publishDate
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { date }
        console.error(`[upload-date] ${client.name}: no date. playability=${data?.playabilityStatus?.status}`)
      } else {
        console.error(`[upload-date] ${client.name}: HTTP ${res.status}`)
      }
    } catch (e) {
      console.error(`[upload-date] ${client.name}: network error —`, (e as Error).message)
    }
  }

  // Scraping fallback — fetch the watch page and grep for embedded date metadata.
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Cookie: 'SOCS=CAISHAgBEhJnd3NfMjAyMzA3MThfMF9SQzIaAmVuIAEaBgiA_LSnBg; CONSENT=YES+cb',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
      console.error(`[upload-date] HTML scrape: no date in ${html.length}-byte response`)
    } else {
      console.error(`[upload-date] HTML scrape: HTTP ${res.status}`)
    }
  } catch (e) {
    console.error(`[upload-date] HTML scrape: network error —`, (e as Error).message)
  }

  return { date: null }
})

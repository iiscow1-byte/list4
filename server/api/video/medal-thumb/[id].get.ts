/**
 * The thumbnail for a Medal clip, as a redirect.
 *
 * Medal does not put a clip's image at a guessable URL, so it has to be asked
 * for — and asking is a JSON round trip, which an `<img>` cannot do. This
 * endpoint is the adapter: give it a clip id and it answers with a redirect to
 * the real image, so every existing `<img src>` on the site keeps working
 * without learning what Medal is.
 *
 * ## Why a cache
 *
 * A list page can hold fifty rows. Without this, opening it would be fifty
 * calls to Medal's API for images that change roughly never — which is both
 * slow for the reader and rude to them. Answers are held in memory for a day,
 * and failures are held too, for a shorter time: a clip that has been deleted
 * should not be re-asked about on every single render.
 *
 * No session is required. The reply is a public image belonging to a public
 * clip, and the page that needs it is public.
 */
const OEMBED = 'https://api-v2.medal.tv/oembed'
const TTL_OK_MS = 24 * 60 * 60 * 1000
const TTL_FAIL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 500

type Entry = { url: string | null; at: number }
const cache = new Map<string, Entry>()

/** Medal clip ids are alphanumeric; anything else is not worth a round trip. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function remember(id: string, url: string | null) {
  // Cheapest possible bound: once it is full, drop the oldest insertion.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(id, { url, at: Date.now() })
}

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '')
  if (!ID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'Bad clip id.' })

  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < (hit.url ? TTL_OK_MS : TTL_FAIL_MS)) {
    if (!hit.url) throw createError({ statusCode: 404, statusMessage: 'No thumbnail.' })
    return sendRedirect(event, hit.url, 302)
  }

  let thumb: string | null = null
  try {
    const target = `https://medal.tv/clips/${encodeURIComponent(id)}`
    const res = await fetch(`${OEMBED}?url=${encodeURIComponent(target)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const json = await res.json() as { thumbnail_url?: unknown }
      const raw = typeof json.thumbnail_url === 'string' ? json.thumbnail_url : null
      // Only ever redirect to Medal's own CDN. An oEmbed reply is a third party
      // choosing a URL, and this endpoint sits on our origin — without the host
      // check it would be an open redirect wearing an image's clothes.
      if (raw && /^https:\/\/[a-z0-9-]+\.medal\.tv\//i.test(raw)) thumb = raw
    }
  } catch {
    thumb = null
  }

  remember(id, thumb)
  if (!thumb) throw createError({ statusCode: 404, statusMessage: 'No thumbnail.' })

  setHeader(event, 'cache-control', 'public, max-age=86400')
  return sendRedirect(event, thumb, 302)
})

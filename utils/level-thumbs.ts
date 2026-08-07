/**
 * Level thumbnails, with a YouTube fallback.
 *
 * Primary source is the Level Thumbnails API (https://levelthumbs.prevter.me) —
 * community-made images keyed by GD level ID:
 *
 *   GET /thumbnail/{id}/{res}  → image (302 to CDN), 404 when none exists
 *
 * Roughly a third of levels have no entry there. For those we fall back to the
 * thumbnail of the level's verification video, which YouTube serves at a
 * predictable URL. Both are plain <img> loads straight from a CDN — the server
 * never proxies an image, so none of this costs us request time.
 *
 * Misses are memoised (in-memory + localStorage) so a level known to have no
 * thumbnail doesn't re-request one on every render or page visit.
 */
export type ThumbRes = 'high' | 'medium' | 'small'

// v2 because the keys are now prefixed — `lv:<gd id>` for the community
// thumbnail and `yt:<video id>` for YouTube's HD one. A v1 store holds bare
// numeric keys; abandoning it costs one re-request per level, once.
const MISS_KEY = 'als:thumb-miss:v2'
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Cap the stored set so a long browsing session can't grow it without bound. */
const MISS_MAX = 4000

/** `lv:`/`yt:` key → epoch ms when we learned that image doesn't exist. */
let missCache: Map<string, number> | null = null

function loadMisses(): Map<string, number> {
  if (missCache) return missCache
  missCache = new Map()
  if (typeof localStorage === 'undefined') return missCache
  try {
    const raw = localStorage.getItem(MISS_KEY)
    if (raw) {
      const cutoff = Date.now() - MISS_TTL_MS
      for (const [key, at] of Object.entries(JSON.parse(raw) as Record<string, number>)) {
        if (at > cutoff) missCache.set(key, at)
      }
    }
  } catch { /* corrupt or unavailable — start empty */ }
  return missCache
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** Write-behind so a burst of misses in one list render is one write. */
function schedulePersist() {
  if (typeof localStorage === 'undefined' || persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const cache = missCache
    if (!cache) return
    try {
      // Keep the newest entries when trimming.
      const entries = [...cache.entries()]
      if (entries.length > MISS_MAX) {
        entries.sort((a, b) => b[1] - a[1])
        entries.length = MISS_MAX
        missCache = new Map(entries)
      }
      localStorage.setItem(MISS_KEY, JSON.stringify(Object.fromEntries(entries)))
    } catch { /* quota — the in-memory cache still works for this session */ }
  }, 1000)
}

export function isKnownThumbMiss(gdId: number | null | undefined): boolean {
  if (!gdId) return false
  return loadMisses().has(`lv:${Number(gdId)}`)
}

export function rememberThumbMiss(gdId: number | null | undefined): void {
  if (!gdId) return
  loadMisses().set(`lv:${Number(gdId)}`, Date.now())
  schedulePersist()
}

/**
 * The same memo for YouTube's `maxresdefault`, keyed by video id.
 *
 * That file only exists for videos uploaded in HD and YouTube 404s for the
 * rest — so every large thumbnail whose level has no community image and whose
 * verification predates HD spends a wasted round trip, on every render, on
 * every page. Remembering the 404 makes it one request ever, and it is the
 * common case rather than an edge one: most of this list was verified years
 * before HD uploads were routine.
 */
export function isKnownMaxresMiss(videoId: string | null | undefined): boolean {
  if (!videoId) return false
  return loadMisses().has(`yt:${videoId}`)
}

export function rememberMaxresMiss(videoId: string | null | undefined): void {
  if (!videoId) return
  loadMisses().set(`yt:${videoId}`, Date.now())
  schedulePersist()
}

export function levelThumbUrl(gdId: number | null | undefined, res: ThumbRes = 'small'): string | null {
  if (!gdId || !Number.isFinite(Number(gdId))) return null
  return `https://levelthumbs.prevter.me/thumbnail/${gdId}/${res}`
}

/**
 * What the three names actually are, measured rather than assumed:
 *
 *   small   640×360    ~200–290 kB
 *   medium  1280×720   ~545–840 kB
 *   high    1920×1080  ~860 kB–1.35 MB
 *
 * Those are heavy files for a decorative background, and the sizes are what
 * makes a fixed `res` the wrong tool. Picking one means every viewport gets the
 * same bytes: a phone downloads a megabyte to paint a 390 px-wide header, and a
 * 1440 px HiDPI screen stretches a 640 px image across a full-width row and
 * looks soft. Offering all three as a `srcset` and describing the element's real
 * width in `sizes` lets the browser choose — which raises quality on big screens
 * and *lowers* the bytes on small ones.
 */
export const THUMB_WIDTHS: Record<ThumbRes, number> = { small: 640, medium: 1280, high: 1920 }

const RES_ORDER: ThumbRes[] = ['small', 'medium', 'high']

/**
 * Candidates up to `maxRes`, which acts as a ceiling rather than a choice.
 *
 * The ceiling matters: a dense list row is 64 px tall and behind a gradient at
 * 12 % opacity, so there is nothing for a 1920 px source to show. Capping those
 * at `small` keeps a 50-row page from asking for 50 MB of images the reader
 * cannot see.
 */
export function levelThumbSrcset(gdId: number | null | undefined, maxRes: ThumbRes = 'small'): string | null {
  if (!gdId || !Number.isFinite(Number(gdId))) return null
  const cap = RES_ORDER.indexOf(maxRes)
  return RES_ORDER.slice(0, cap + 1)
    .map((r) => `https://levelthumbs.prevter.me/thumbnail/${gdId}/${r} ${THUMB_WIDTHS[r]}w`)
    .join(', ')
}

/**
 * A default `sizes` for each ceiling, used when a call site doesn't say.
 *
 * Deliberately conservative — `sizes` too large wastes bytes, too small looks
 * soft, and the component has no way to measure its own parent. Call sites with
 * an unusual layout pass their own.
 */
export const THUMB_SIZES: Record<ThumbRes, string> = {
  // Dense rows: narrow on phones, roughly half a wide window in two-column
  // layouts, and never worth more than the 640 px source.
  small: '(max-width: 640px) 100vw, 640px',
  // Cards and panels.
  medium: '(max-width: 640px) 100vw, (max-width: 1280px) 60vw, 800px',
  // Full-bleed heroes and profile covers.
  high: '100vw',
}

/** Extract a YouTube video id from any of the URL shapes YouTube uses. */
export function youtubeIdFrom(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  for (const re of [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{6,})/,
  ]) {
    const m = url.match(re)
    if (m) return m[1]!
  }
  return null
}

/**
 * Thumbnail for a video URL. `hqdefault` (480×360) exists for every public
 * video, so it is the safe choice for a fallback that must not fail twice.
 */
export function videoThumbUrl(videoUrl: string | null | undefined, res: ThumbRes = 'small'): string | null {
  const id = youtubeIdFrom(videoUrl)
  if (!id) return null
  return `https://i.ytimg.com/vi/${id}/${res === 'high' ? 'hqdefault' : 'mqdefault'}.jpg`
}

/**
 * The 1280×720 version of a video's thumbnail, or null.
 *
 * YouTube only generates `maxresdefault` for videos uploaded in HD, and returns
 * 404 for the rest — so this can never be the only fallback. It is offered
 * first *only* in large contexts, where hqdefault's 480×360 (with black bars
 * down to an effective 480×270) is visibly soft across a full-width header. A
 * dense row never asks for it, so the extra request on a miss is paid once, on
 * one image, on the pages where the difference is actually visible.
 */
export function videoThumbUrlMax(videoUrl: string | null | undefined): string | null {
  const id = youtubeIdFrom(videoUrl)
  if (!id) return null
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
}

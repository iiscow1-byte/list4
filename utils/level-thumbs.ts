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

const MISS_KEY = 'als:thumb-miss:v1'
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Cap the stored set so a long browsing session can't grow it without bound. */
const MISS_MAX = 4000

/** gd_id → epoch ms when we learned it has no levelthumbs image. */
let missCache: Map<number, number> | null = null

function loadMisses(): Map<number, number> {
  if (missCache) return missCache
  missCache = new Map()
  if (typeof localStorage === 'undefined') return missCache
  try {
    const raw = localStorage.getItem(MISS_KEY)
    if (raw) {
      const cutoff = Date.now() - MISS_TTL_MS
      for (const [id, at] of Object.entries(JSON.parse(raw) as Record<string, number>)) {
        if (at > cutoff) missCache.set(Number(id), at)
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
  return loadMisses().has(Number(gdId))
}

export function rememberThumbMiss(gdId: number | null | undefined): void {
  if (!gdId) return
  loadMisses().set(Number(gdId), Date.now())
  schedulePersist()
}

export function levelThumbUrl(gdId: number | null | undefined, res: ThumbRes = 'small'): string | null {
  if (!gdId || !Number.isFinite(Number(gdId))) return null
  return `https://levelthumbs.prevter.me/thumbnail/${gdId}/${res}`
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
 * Thumbnail for a video URL. `hqdefault` exists for every public video (unlike
 * maxresdefault, which 404s on anything not uploaded in HD), so it is the safe
 * choice for a fallback that must not fail twice.
 */
export function videoThumbUrl(videoUrl: string | null | undefined, res: ThumbRes = 'small'): string | null {
  const id = youtubeIdFrom(videoUrl)
  if (!id) return null
  return `https://i.ytimg.com/vi/${id}/${res === 'high' ? 'hqdefault' : 'mqdefault'}.jpg`
}

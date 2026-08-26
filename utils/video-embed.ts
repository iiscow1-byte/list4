/**
 * One place that decides what a stored video URL actually is.
 *
 * Every proof link on this site — `records.video`, `levels.verification_url`,
 * `pending_levels.verification_url`, `open_verifications.showcase_url`,
 * `custom_list_records.video` — is a plain TEXT column holding whatever the
 * submitter typed. For years the only thing the UI could do with one was pull a
 * YouTube id out of it and build an `<iframe>` src by hand, which every call
 * site did separately with its own copy of the same regex list. That meant a
 * Medal.tv clip or an uploaded file was invisible: the `v-if` gated on a
 * YouTube id, so a perfectly good link rendered as nothing at all.
 *
 * `resolveVideo` is the single answer to "what is this URL, and what do I put
 * in the DOM for it?". Call sites gate on `kind !== 'none'` rather than on a
 * YouTube id, so adding a source here lights it up everywhere at once.
 *
 * The YouTube half deliberately delegates to `youtubeIdFrom` in `level-thumbs`
 * rather than restating its patterns — the thumbnail code and the embed code
 * disagreeing about which video a URL points at is precisely the bug worth
 * designing out.
 */
import { youtubeIdFrom } from './level-thumbs'

export type VideoSource = {
  kind: 'youtube' | 'medal' | 'file' | 'none'
  /** What goes in an `<iframe src>` (youtube/medal) or a `<video src>` (file). */
  embedUrl: string | null
  /** A still image for the clip, where the host publishes a predictable one. */
  thumbUrl: string | null
  /** The URL as stored, so a caller can still link out to the original. */
  rawUrl: string | null
}

const NONE: VideoSource = { kind: 'none', embedUrl: null, thumbUrl: null, rawUrl: null }

/**
 * Medal writes the same clip three different ways.
 *
 * The canonical share link carries the game slug (`/games/<game>/clips/<id>/<hash>`),
 * the short link drops it (`/clips/<id>/<hash>`), and the player itself links
 * back with a bare query parameter (`medal.tv/?contentId=<id>`). All three name
 * the same clip, and only the id survives into the embed URL — the trailing
 * hash is a share token, not part of the identity.
 *
 * The `/clip/<id>/embed` form is matched too, so pasting an embed URL back in
 * round-trips instead of failing.
 */
const MEDAL_PATTERNS: RegExp[] = [
  /medal\.tv\/games\/[^/?#]+\/clips\/([A-Za-z0-9_-]+)/i,
  /medal\.tv\/clips\/([A-Za-z0-9_-]+)/i,
  /medal\.tv\/clip\/([A-Za-z0-9_-]+)/i,
  /medal\.tv[^\s]*[?&]contentId=([A-Za-z0-9_-]+)/i,
]

/** The Medal clip id in any of the shapes Medal hands out, or null. */
export function medalIdFrom(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  if (!/medal\.tv/i.test(url)) return null
  for (const re of MEDAL_PATTERNS) {
    const m = url.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

/**
 * The path part of a URL that may be absolute or site-relative.
 *
 * Uploaded clips are stored as `/api/uploads/<hex>.mp4`, which `new URL` will
 * not parse on its own; the throwaway base gives it something to resolve
 * against so both forms take the same code path.
 */
function pathOf(url: string): string {
  try {
    return new URL(url, 'https://relative.invalid').pathname
  } catch {
    return url.split(/[?#]/)[0] ?? url
  }
}

/**
 * Only http(s) and root-relative URLs are ever put in a `src`.
 *
 * These strings come from a text column a user typed into. Without this, a
 * value like `javascript:…/x.mp4` would match the extension test below and be
 * handed straight to the DOM. A `<video src>` will not execute it, but the
 * check belongs at the boundary rather than resting on that.
 */
function isSafeMediaUrl(url: string): boolean {
  if (url.startsWith('//')) return false
  if (url.startsWith('/')) return true
  return /^https?:\/\//i.test(url)
}

/**
 * What to render for a stored video URL.
 *
 * Never throws and never returns a partly-filled result: `kind === 'none'`
 * means there is nothing to show, and every other kind guarantees `embedUrl`.
 */
export function resolveVideo(url: string | null | undefined): VideoSource {
  if (!url || typeof url !== 'string') return NONE
  const raw = url.trim()
  if (!raw) return NONE

  /**
   * The host gate is load-bearing now that other kinds exist.
   *
   * `youtubeIdFrom`'s first pattern is a bare `[?&]v=` — it says nothing about
   * where the URL points. That was harmless while YouTube was the only thing
   * this site embedded, but a signed CDN link ending `clip.mp4?v=1739204` also
   * matches it, and would have been turned into a YouTube iframe for a video id
   * that does not exist. Requiring a YouTube hostname before trusting the id
   * only ever *removes* embeds that were already broken.
   */
  const isYouTubeHost = /(^|[./@])(youtube\.com|youtube-nocookie\.com|youtu\.be)/i.test(raw)
  const ytId = isYouTubeHost ? youtubeIdFrom(raw) : null
  if (ytId) {
    return {
      kind: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${ytId}`,
      thumbUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      rawUrl: raw,
    }
  }

  const medalId = medalIdFrom(raw)
  if (medalId) {
    // Medal exposes no predictable still for a clip id — the poster frame is
    // only in the oEmbed/API payload, which is a server round trip this does
    // not have. Callers fall back to level art, as they already do.
    return {
      kind: 'medal',
      embedUrl: `https://medal.tv/clip/${medalId}/embed`,
      thumbUrl: null,
      rawUrl: raw,
    }
  }

  if (isSafeMediaUrl(raw)) {
    const path = pathOf(raw)
    if (path.startsWith('/api/uploads/') || /\.(mp4|webm)$/i.test(path)) {
      return { kind: 'file', embedUrl: raw, thumbUrl: null, rawUrl: raw }
    }
  }

  return NONE
}

/** Whether this URL is something `<VideoEmbed>` can actually render. */
export function isEmbeddableVideo(url: string | null | undefined): boolean {
  return resolveVideo(url).kind !== 'none'
}

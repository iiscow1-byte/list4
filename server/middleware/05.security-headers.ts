/**
 * Response headers the site was sending none of.
 *
 * Each one closes a specific hole, and the ones that would break the site if
 * set naively are set to the strongest value that doesn't.
 *
 * ## `Content-Security-Policy`
 *
 * `script-src` includes `'unsafe-inline'`, and that is a real weakening worth
 * being honest about rather than hiding behind a long policy. Nuxt's SSR
 * hydration payload is an inline `<script>` on every page; locking it down
 * properly needs a per-request nonce threaded through the renderer, which Nuxt
 * does not do out of the box. Adding a nonce that the framework then bypasses
 * would be a policy that *looks* strict and isn't.
 *
 * What the policy does buy, even so:
 *
 *   - `object-src 'none'` — no Flash/PDF plugin embedding, a persistent XSS
 *     vector on old renderers.
 *   - `base-uri 'self'` — an injected `<base>` cannot re-point every relative
 *     URL on the page at another origin.
 *   - `form-action 'self'` — an injected form cannot post credentials away.
 *   - `frame-ancestors 'none'` — the site cannot be framed, which is
 *     clickjacking closed. This is the header version of `X-Frame-Options` and
 *     supersedes it in modern browsers; the older header is sent too, for the
 *     ones that only understand that.
 *
 * `img-src` allows any HTTPS host on purpose: clan icons, custom-list banners
 * and profile covers are URLs their owners supply, and an allow-list would mean
 * the site silently dropping images people had set. Images cannot execute, so
 * the exposure is a broken picture and a referrer — and `Referrer-Policy`
 * below deals with the second.
 */
const CSP = [
  "default-src 'self'",
  // Hydration payload and Tailwind's injected styles. See the note above.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  // The API talks only to itself; everything third-party is fetched server-side.
  "connect-src 'self'",
  /**
   * Verification videos and level showcases.
   *
   * Medal.tv joins YouTube here because a Medal clip is embedded the same way —
   * an `<iframe>` at `medal.tv/clip/<id>/embed`. Without the host in this list
   * the frame is blocked by the policy and the level page shows an empty box,
   * which is a confusing way to discover a CSP. Still an allow-list of two:
   * `frame-src` is what decides whose code can run in a frame on this origin.
   */
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://medal.tv https://www.medal.tv",
  // `'self'` covers clips uploaded here and served from /api/uploads/.
  "media-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ')

export default defineEventHandler((event) => {
  const res = event.node?.res
  if (!res || res.headersSent) return

  /**
   * The single most important header here.
   *
   * Avatars are user-uploaded bytes served back from this origin. Without this,
   * a browser is free to ignore the declared `Content-Type` and sniff the
   * content — so a file uploaded as `image/png` that actually contains HTML can
   * be rendered as HTML, on this origin, with this origin's cookies. That is
   * stored XSS. `avatar.post.ts` also checks the bytes now, and this is the
   * second half of the same fix.
   */
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  // Superseded by `frame-ancestors` above, kept for browsers that predate it.
  setHeader(event, 'X-Frame-Options', 'DENY')

  /**
   * Send the origin to other sites, never the path.
   *
   * A level page's URL says which level somebody was reading and a profile's
   * says whose profile — neither belongs in another site's logs just because a
   * page linked to a verification video.
   */
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')

  // Nothing here uses any of them; saying so stops an embedded frame asking.
  setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')

  /**
   * HSTS, in production only.
   *
   * Sending it in development would pin `localhost` to HTTPS in the developer's
   * browser — a cache entry that outlives the process and is a genuine nuisance
   * to clear. No `preload`: that is a one-way door onto a browser-vendor list,
   * and it is the operator's decision to walk through, not this file's.
   */
  if (process.env.NODE_ENV === 'production') {
    setHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  /**
   * The policy goes on documents only.
   *
   * Applying it to API responses and static assets costs a few hundred bytes on
   * every request for no benefit — a JSON body has no scripts, styles or frames
   * for a policy to govern.
   */
  const path = event.path ?? ''
  const isApi = path.startsWith('/api/') || path.startsWith('/_nuxt/')
  if (!isApi) setHeader(event, 'Content-Security-Policy', CSP)
})

import { INTERNAL_HEADER, INTERNAL_TOKEN } from '~/server/utils/internal-token'

/**
 * Stamps server-side `$fetch` calls to our own API with the internal token, so
 * the lockdown middleware can tell "this server rendering a page" apart from
 * "someone on the internet".
 *
 * Wrapped once at startup rather than per request: there is no per-request
 * state here, so nothing can leak between concurrent renders. Only relative
 * URLs are stamped — an absolute URL is a third-party host (the Google Sheet,
 * the GD API, YouTube) and must never see the token.
 *
 * This is server-only. The browser's `$fetch` is a different instance and is
 * untouched, which is the point: a client cannot obtain the token.
 */
type FetchLike = typeof globalThis.$fetch

/**
 * A path on this server — not a `URL`, and not protocol-relative.
 *
 * `//evil.example.com/x` begins with a slash but resolves to another host, so
 * a bare `startsWith('/')` would hand the token to whoever owns it.
 */
function isLocal(request: unknown): boolean {
  return typeof request === 'string' && request.startsWith('/') && !request.startsWith('//')
}

function withToken(request: unknown, opts: any) {
  if (!isLocal(request)) return opts
  return { ...(opts ?? {}), headers: { ...(opts?.headers ?? {}), [INTERNAL_HEADER]: INTERNAL_TOKEN } }
}

export default defineNitroPlugin(() => {
  const original = globalThis.$fetch
  if (!original || (original as any).__alsInternalWrapped) return

  const wrapped = ((request: any, opts?: any) =>
    original(request, withToken(request, opts))) as FetchLike

  // `$fetch` carries helpers alongside the call signature; keep them working.
  wrapped.raw = ((request: any, opts?: any) =>
    original.raw(request, withToken(request, opts))) as FetchLike['raw']
  wrapped.create = original.create.bind(original)
  wrapped.native = original.native
  ;(wrapped as any).__alsInternalWrapped = true

  globalThis.$fetch = wrapped
})

import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

/**
 * Compress JSON and HTML responses.
 *
 * Nitro pre-compresses static files but sends everything it renders as is, so a
 * page of the level list went out as ~290 KB of JSON. Brotli at a low quality
 * gets that to a few dozen KB in a few milliseconds. Skipped in dev, for small
 * bodies, and when something upstream already set an encoding.
 */
const MIN_BYTES = 1024

export default defineNitroPlugin((nitro) => {
  if (import.meta.dev) return

  nitro.hooks.hook('beforeResponse', (event, response) => {
    const res = event.node.res
    if (res.headersSent || res.getHeader('content-encoding')) return
    const accept = String(event.node.req.headers['accept-encoding'] ?? '')
    const br = /\bbr\b/.test(accept)
    if (!br && !/\bgzip\b/.test(accept)) return

    let text: string
    const body = response.body
    const type = String(res.getHeader('content-type') ?? '')
    if (typeof body === 'string') {
      if (type && !/json|html|text|javascript|xml/.test(type)) return
      text = body
    } else if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)
      && typeof (body as any).pipe !== 'function' && !(body instanceof ReadableStream)) {
      text = JSON.stringify(body)
      if (!type) res.setHeader('content-type', 'application/json; charset=utf-8')
    } else {
      return
    }
    if (Buffer.byteLength(text) < MIN_BYTES) return

    const out = br
      ? brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
      : gzipSync(text, { level: 6 })
    res.setHeader('content-encoding', br ? 'br' : 'gzip')
    res.setHeader('vary', 'Accept-Encoding')
    res.removeHeader('content-length')
    response.body = out
  })
})

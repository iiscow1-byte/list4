import { createReadStream, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '~/server/db'
import { TYPE_BY_EXT } from '~/server/utils/video-type'

/**
 * Serve a clip uploaded through `index.post.ts`.
 *
 * The name is the whole security boundary, so it is matched against a literal
 * shape rather than sanitised: exactly lowercase hex, one dot, `mp4` or `webm`.
 * Nothing that shape allows can escape the uploads directory — there is no
 * slash, no backslash, no second dot, no `..`, no NUL — so path traversal is
 * closed by construction instead of by a blocklist that has to anticipate every
 * encoding. `getRouterParam` percent-decodes first, so `%2e%2e%2f` arrives as
 * `../` and is refused by the same test.
 *
 * The extension picking the `Content-Type` is safe here only because the upload
 * side chose that extension from the file's own bytes; a client has never had a
 * say in it. See `server/utils/video-type.ts`.
 */
const NAME_RE = /^[a-f0-9]+\.(mp4|webm)$/

export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name') ?? ''
  const m = NAME_RE.exec(name)
  if (!m) throw createError({ statusCode: 400, statusMessage: 'Bad clip name.' })

  const full = join(dataDir(), 'uploads', name)
  let size: number
  try {
    const st = statSync(full)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Clip not found.' })
  }

  setHeader(event, 'content-type', TYPE_BY_EXT[m[1]!]!)
  // Belt and braces, exactly as the avatar route does: this response is
  // user-uploaded bytes and must never be sniffed into a document.
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Disposition', 'inline')
  // The name is random and the bytes behind it never change, so the file is
  // immutable by construction — there is nothing for a cache to get wrong.
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  setHeader(event, 'accept-ranges', 'bytes')

  /**
   * Range support, because a `<video>` element is not a download.
   *
   * Without it a browser can only play from the first byte: dragging the
   * scrubber re-requests the whole file and Safari refuses to start at all,
   * since it opens every media element with a range request. Streaming the
   * requested slice is what makes seeking work.
   */
  const range = getRequestHeader(event, 'range')
  const rm = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (rm) {
    const [, rawStart, rawEnd] = rm
    let start: number
    let end: number
    if (!rawStart && rawEnd) {
      // A suffix range — "the last N bytes".
      const n = Number(rawEnd)
      start = Math.max(0, size - n)
      end = size - 1
    } else {
      start = Number(rawStart || 0)
      end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      setResponseStatus(event, 416)
      setHeader(event, 'content-range', `bytes */${size}`)
      return ''
    }

    setResponseStatus(event, 206)
    setHeader(event, 'content-range', `bytes ${start}-${end}/${size}`)
    setHeader(event, 'content-length', end - start + 1)
    return sendStream(event, createReadStream(full, { start, end }))
  }

  setHeader(event, 'content-length', size)
  return sendStream(event, createReadStream(full))
})

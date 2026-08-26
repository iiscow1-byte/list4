import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'

/**
 * A poster frame for an uploaded clip.
 *
 * The frame is drawn in the browser — a `<video>` seeked a second in and
 * painted to a `<canvas>` — and posted here as a JPEG. Extracting it on the
 * server would mean decoding video, which means ffmpeg, which is a large
 * dependency to add for one thumbnail when every uploader already has a decoder
 * in front of them.
 *
 * That does mean the image is whatever the client sent, so it is treated as
 * hostile: the bytes must actually start with a JPEG signature, the size is
 * capped well below anything a poster needs, and it can only ever be written
 * beside a clip that already exists under a name this server generated.
 */
const MAX_POSTER_BYTES = 2 * 1024 * 1024
const CLIP_RE = /^[a-f0-9]+\.(mp4|webm)$/

export default defineEventHandler(async (event) => {
  requireAccount(event)
  enforceRateLimit(event, LIMITS.submission)

  const clip = String(getQuery(event).for ?? '')
  // The same shape check the serving route uses. No traversal is possible
  // through it, and it also means a poster cannot be attached to anything but
  // a real clip name.
  if (!CLIP_RE.test(clip)) throw createError({ statusCode: 400, statusMessage: 'Bad clip name.' })

  const dir = join(dataDir(), 'uploads')
  if (!existsSync(join(dir, clip))) {
    throw createError({ statusCode: 404, statusMessage: 'No such clip.' })
  }

  const body = await readRawBody(event, false)
  if (!body || !(body instanceof Buffer) || body.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No image uploaded.' })
  }
  if (body.length > MAX_POSTER_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Poster too large.' })
  }
  // JPEG, by its own bytes — `image/jpeg` on the request would be the client's
  // word for it, and this file is served back from our origin.
  if (!(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) {
    throw createError({ statusCode: 400, statusMessage: 'Poster must be a JPEG.' })
  }

  const stem = clip.slice(0, clip.lastIndexOf('.'))
  writeFileSync(join(dir, `${stem}.jpg`), body)
  return { url: `/api/uploads/${stem}.jpg` }
})

import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { sniffVideoType, VIDEO_EXT } from '~/server/utils/video-type'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'

/**
 * Somewhere to put a clip that is not YouTube.
 *
 * Every proof link on this site is a URL in a TEXT column, and for people whose
 * runs live in Medal or in a local recording that meant uploading to YouTube
 * first — a step that loses runs. This writes the bytes next to the database
 * and hands back the same kind of thing the column already holds: a URL. The
 * schema does not change and neither does any read path; `resolveVideo` in
 * `utils/video-embed.ts` recognises `/api/uploads/…` and renders a `<video>`.
 */
const MAX_CLIP_BYTES = 64 * 1024 * 1024

export default defineEventHandler(async (event) => {
  requireAccount(event)
  // Sixty-four megabytes a go is worth the same ceiling submissions get.
  enforceRateLimit(event, LIMITS.submission)

  /**
   * Refuse an oversized body before buffering it.
   *
   * `readMultipartFormData` reads the whole request into memory, so checking
   * the size after the fact means a 2 GB upload is already resident by the time
   * it is rejected. The header is only a claim — the real check is still below,
   * on the actual byte count — but it turns the common honest case (someone
   * picking a long recording) into an instant 413 rather than a long wait.
   */
  const declared = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_CLIP_BYTES + 1024 * 1024) {
    throw createError({ statusCode: 413, statusMessage: 'Clips must be 64 MB or smaller.' })
  }

  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file' && p.data?.length)
    ?? parts?.find((p) => p.filename && p.data?.length)
  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'No file uploaded.' })

  if (file.data.length > MAX_CLIP_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Clips must be 64 MB or smaller.' })
  }

  /**
   * The type comes from the bytes, not from the request.
   *
   * Same reasoning as `account/avatar.post.ts`: `file.type` is the multipart
   * part's declared `Content-Type` and the uploader writes it, so a file
   * containing HTML can arrive labelled `video/mp4`. `sniffVideoType` reads the
   * container signature instead and the derived value is what picks the
   * extension on disk — which is why `[name].get.ts` can trust that extension
   * when it chooses the response's `Content-Type`.
   *
   * The client's filename is discarded entirely. It is attacker-controlled and
   * nothing downstream needs it; the stored name is random hex.
   */
  const type = sniffVideoType(file.data)
  if (!type) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Clips must be an MP4 or WebM video.',
    })
  }

  const dir = join(dataDir(), 'uploads')
  mkdirSync(dir, { recursive: true })

  // Random rather than derived from anything: the name is the only thing
  // guarding the file, and a name that encodes the uploader or a counter is a
  // name other people can guess their way through.
  const name = `${randomBytes(16).toString('hex')}.${VIDEO_EXT[type]}`
  writeFileSync(join(dir, name), file.data)

  return { url: `/api/uploads/${name}` }
})

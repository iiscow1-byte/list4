import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { sniffVideoType, VIDEO_EXT } from '~/server/utils/video-type'
import { readMp4CreationDate } from '~/server/utils/mp4-meta'
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
 *
 * ## Why the body is the file, and not a multipart form
 *
 * The first version read the request with `readMultipartFormData`, which
 * buffers the entire body in memory before handing it over. That is survivable
 * at 64 MB and is not survivable at a gigabyte: two people uploading at once
 * would be two gigabytes of resident memory, and the process is killed long
 * before either finishes — taking the site down with it, for an upload.
 *
 * So the client PUTs the file as the raw body and this streams it to disk,
 * holding only one chunk at a time. Memory is flat regardless of the file's
 * size, which is the only property that makes a limit this large safe.
 */
const MAX_CLIP_BYTES = 1024 * 1024 * 1024
const MAX_CLIP_LABEL = '1 GB'
/** Enough of the head to identify an MP4 or WebM container. */
const SNIFF_BYTES = 256

export default defineEventHandler(async (event) => {
  requireAccount(event)
  enforceRateLimit(event, LIMITS.submission)

  /**
   * Refuse an oversized upload before a byte of it is written.
   *
   * The header is a claim, not a fact — the running total below is the real
   * check — but honouring it turns the ordinary case (somebody picking a
   * two-hour recording) into an instant refusal rather than a long transfer
   * that fails at the end.
   */
  const declared = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_CLIP_BYTES) {
    throw createError({ statusCode: 413, statusMessage: `Clips must be ${MAX_CLIP_LABEL} or smaller.` })
  }

  const dir = join(dataDir(), 'uploads')
  mkdirSync(dir, { recursive: true })

  // Written under a temporary name and moved into place only once the whole
  // file has arrived and been identified, so a cancelled upload can never leave
  // something behind that `[name].get.ts` would serve.
  const stem = randomBytes(16).toString('hex')
  const tmpPath = join(dir, `${stem}.part`)

  const req = event.node.req
  const out = createWriteStream(tmpPath)

  let received = 0
  const head: Buffer[] = []
  let headLen = 0
  let type: ReturnType<typeof sniffVideoType> = null
  let sniffed = false

  const cleanup = () => { try { rmSync(tmpPath, { force: true }) } catch { /* already gone */ } }

  try {
    await new Promise<void>((resolve, reject) => {
      const failWith = (err: any) => { out.destroy(); req.unpipe?.(out); reject(err) }

      req.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > MAX_CLIP_BYTES) {
          failWith(createError({ statusCode: 413, statusMessage: `Clips must be ${MAX_CLIP_LABEL} or smaller.` }))
          return
        }

        /**
         * The type comes from the bytes, never from the request.
         *
         * Same reasoning as `account/avatar.post.ts`: a `Content-Type` header is
         * written by whoever made the request, so a file full of HTML can arrive
         * labelled `video/mp4`. Sniffing the container is what makes the stored
         * extension trustworthy — and the extension is what `[name].get.ts`
         * later turns back into a response `Content-Type`.
         *
         * Decided as soon as enough of the head has arrived, so a wrong file is
         * refused after a few kilobytes rather than after a gigabyte.
         */
        if (!sniffed) {
          head.push(chunk)
          headLen += chunk.length
          if (headLen >= SNIFF_BYTES) {
            sniffed = true
            type = sniffVideoType(Buffer.concat(head, headLen))
            if (!type) {
              failWith(createError({ statusCode: 400, statusMessage: 'Clips must be an MP4 or WebM video.' }))
              return
            }
          }
        }

        if (!out.write(chunk)) { req.pause?.(); out.once('drain', () => req.resume?.()) }
      })

      req.on('end', () => {
        // A file shorter than the sniff window still has to be identified.
        if (!sniffed) {
          type = headLen ? sniffVideoType(Buffer.concat(head, headLen)) : null
          if (!type) {
            failWith(createError({ statusCode: 400, statusMessage: 'Clips must be an MP4 or WebM video.' }))
            return
          }
        }
        out.end(() => resolve())
      })

      req.on('error', failWith)
      out.on('error', failWith)
    })
  } catch (err) {
    cleanup()
    throw err
  }

  if (!type || received === 0) {
    cleanup()
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded.' })
  }

  // Rename rather than re-write: the bytes are already where they need to be.
  const name = `${stem}.${VIDEO_EXT[type]}`
  const { renameSync } = await import('node:fs')
  try {
    renameSync(tmpPath, join(dir, name))
  } catch (err) {
    cleanup()
    throw createError({ statusCode: 500, statusMessage: 'Could not store the clip.' })
  }

  /**
   * The date the clip says it was recorded.
   *
   * Read after the move, from the file rather than from the stream, because
   * `moov` is usually the last box in a screen recording — the metadata arrives
   * after the video it describes. Null whenever the file has no usable date;
   * the submit form leaves the field blank rather than filling in a guess.
   *
   * WebM's date lives in an EBML `DateUTC` element, which is a different parser
   * for a format almost nothing here uploads, so it is not read.
   */
  const recordedAt = type === 'video/mp4' ? readMp4CreationDate(join(dir, name)) : null

  return { url: `/api/uploads/${name}`, bytes: received, recordedAt }
})

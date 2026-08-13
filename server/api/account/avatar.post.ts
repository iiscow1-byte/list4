import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { sniffImageType } from '~/server/utils/image-type'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'

const MAX_AVATAR_BYTES = 1 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  // An upload writes a megabyte to the database. Bounded like the rest.
  enforceRateLimit(event, LIMITS.submission)

  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'avatar' && p.data && p.data.length > 0)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'No file uploaded.' })

  if (file.data.length > MAX_AVATAR_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Avatar must be 1 MB or smaller.' })
  }

  /**
   * The type comes from the bytes, not from the request.
   *
   * This used to read `file.type` — the `Content-Type` on the multipart part,
   * which the uploader writes and can say anything. A file full of HTML
   * labelled `image/png` was stored as `image/png` and served back from this
   * origin under that label, which on a sniffing browser is stored XSS holding
   * this site's session cookie.
   *
   * `sniffImageType` reads the signature instead and refuses anything that is
   * not one of the four formats. The derived value is what gets stored, so the
   * claim never survives past this line. See also the `nosniff` header in
   * `server/middleware/05.security-headers.ts` — the two are halves of one fix.
   */
  const type = sniffImageType(file.data)
  if (!type) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Avatar must be a PNG, JPEG, GIF or WebP image.',
    })
  }

  getDb().prepare(`UPDATE accounts SET avatar_blob = ?, avatar_type = ? WHERE id = ?`)
    .run(file.data, type, me.id)
  return { ok: true }
})

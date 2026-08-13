import { getDb } from '~/server/db'
import { sniffImageType } from '~/server/utils/image-type'

/**
 * Serve an account's avatar.
 *
 * The stored `avatar_type` is used only when the bytes agree with it. Rows
 * predating the upload-side signature check hold whatever `Content-Type` the
 * uploader declared at the time, so trusting the column would keep serving the
 * one thing that check exists to prevent — the fix has to cover what is already
 * in the table, not just what arrives next.
 *
 * Anything whose bytes are not a recognised image is served as
 * `application/octet-stream`, which browsers download rather than render.
 * Combined with `nosniff` (see `server/middleware/05.security-headers.ts`) that
 * makes an unrecognised blob inert.
 */
export default defineEventHandler((event) => {
  const username = getRouterParam(event, 'username')
  if (!username) throw createError({ statusCode: 400, statusMessage: 'username required' })

  const row = getDb().prepare(
    `SELECT avatar_blob, avatar_type FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as { avatar_blob: Uint8Array | null; avatar_type: string | null } | undefined
  if (!row?.avatar_blob) throw createError({ statusCode: 404, statusMessage: 'No avatar.' })

  const actual = sniffImageType(row.avatar_blob)

  setHeader(event, 'content-type', actual ?? 'application/octet-stream')
  // Belt and braces: this route in particular must never be sniffed, and the
  // global middleware could be reordered by someone who doesn't know that.
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  // Never rendered as a document, whatever it turns out to contain.
  setHeader(event, 'Content-Disposition', 'inline')
  setHeader(event, 'cache-control', 'private, max-age=60')
  return Buffer.from(row.avatar_blob)
})

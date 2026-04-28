import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

const MAX_AVATAR_BYTES = 1 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'avatar' && p.data && p.data.length > 0)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'No file uploaded.' })

  const type = file.type ?? 'application/octet-stream'
  if (!ALLOWED_TYPES.has(type)) {
    throw createError({ statusCode: 400, statusMessage: 'Avatar must be a PNG, JPEG, GIF, or WebP image.' })
  }
  if (file.data.length > MAX_AVATAR_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Avatar must be 1 MB or smaller.' })
  }

  getDb().prepare(`UPDATE accounts SET avatar_blob = ?, avatar_type = ? WHERE id = ?`)
    .run(file.data, type, me.id)
  return { ok: true }
})

import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const username = getRouterParam(event, 'username')
  if (!username) throw createError({ statusCode: 400, statusMessage: 'username required' })

  const row = getDb().prepare(
    `SELECT avatar_blob, avatar_type FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as { avatar_blob: Uint8Array | null; avatar_type: string | null } | undefined
  if (!row?.avatar_blob) throw createError({ statusCode: 404, statusMessage: 'No avatar.' })

  setHeader(event, 'content-type', row.avatar_type || 'application/octet-stream')
  setHeader(event, 'cache-control', 'private, max-age=60')
  return Buffer.from(row.avatar_blob)
})

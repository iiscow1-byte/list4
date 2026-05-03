import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

const VALID_KINDS = new Set(['profile', 'progress', 'open_verification'])
const MAX_BODY = 1000

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody(event)
  const kind = String(body?.kind ?? '')
  const targetId = Number(body?.target_id)
  const text = String(body?.body ?? '').trim()

  if (!VALID_KINDS.has(kind) || !Number.isInteger(targetId) || targetId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'kind and target_id required.' })
  }
  if (!text) throw createError({ statusCode: 400, statusMessage: 'Comment body is required.' })
  if (text.length > MAX_BODY) {
    throw createError({ statusCode: 400, statusMessage: `Comment must be ≤${MAX_BODY} characters.` })
  }

  const db = getDb()
  const result = db.prepare(
    `INSERT INTO comments (account_id, target_kind, target_id, body) VALUES (?, ?, ?, ?)`,
  ).run(me.id, kind, targetId, text)

  return {
    id: Number(result.lastInsertRowid),
    account_id: me.id,
    username: me.username,
    role: me.role,
    has_avatar: me.has_avatar,
    body: text,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }
})

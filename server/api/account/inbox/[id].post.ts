import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * Mark an inbox message read or unread. Body: { action: 'read' | 'unread' }.
 * Only the recipient can change their own messages.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }
  const body = await readBody<{ action?: 'read' | 'unread' }>(event)
  const action = body?.action === 'unread' ? 'unread' : 'read'

  const db = getDb()
  const row = db.prepare(`SELECT account_id FROM inbox_messages WHERE id = ?`).get(id) as { account_id: number } | undefined
  if (!row || row.account_id !== me.id) {
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  }

  if (action === 'read') {
    db.prepare(`UPDATE inbox_messages SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL`).run(id)
  } else {
    db.prepare(`UPDATE inbox_messages SET read_at = NULL WHERE id = ?`).run(id)
  }
  return { ok: true }
})

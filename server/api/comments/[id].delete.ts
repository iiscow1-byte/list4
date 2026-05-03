import { getDb } from '~/server/db'
import { requireAccount, isModRole } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const commentId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(commentId) || commentId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid comment id.' })
  }

  const db = getDb()
  const comment = db.prepare(`SELECT id, account_id FROM comments WHERE id = ?`).get(commentId) as
    | { id: number; account_id: number }
    | undefined
  if (!comment) throw createError({ statusCode: 404, statusMessage: 'Comment not found.' })

  const isMod = isModRole(me.role as any)
  if (comment.account_id !== me.id && !isMod) {
    throw createError({ statusCode: 403, statusMessage: 'Not allowed.' })
  }

  db.prepare(`DELETE FROM comments WHERE id = ?`).run(commentId)
  return { ok: true }
})

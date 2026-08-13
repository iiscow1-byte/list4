import { getDb } from '~/server/db'
import { requireAccount, isModRole } from '~/server/utils/auth'
import { logActivity } from '~/server/utils/activity-log'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const commentId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(commentId) || commentId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid comment id.' })
  }

  const db = getDb()
  /**
   * The body and the author are read *before* the delete, and kept.
   *
   * This is the half of comment logging that actually earns its place. A
   * comment that is still there can be read; one that was deleted is the case
   * somebody investigating a report is asking about, and without this the row
   * simply vanished — leaving a report pointing at nothing and no way to tell
   * whether it was removed because it was bad or because its author thought
   * better of it.
   */
  const comment = db.prepare(
    `SELECT c.id, c.account_id, c.body, c.target_kind, c.target_id, a.username
       FROM comments c
       LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.id = ?`,
  ).get(commentId) as
    | { id: number; account_id: number; body: string; target_kind: string; target_id: number; username: string | null }
    | undefined
  if (!comment) throw createError({ statusCode: 404, statusMessage: 'Comment not found.' })

  const isMod = isModRole(me.role as any)
  const isOwnComment = comment.account_id === me.id
  if (!isOwnComment && !isMod) {
    throw createError({ statusCode: 403, statusMessage: 'Not allowed.' })
  }

  db.prepare(`DELETE FROM comments WHERE id = ?`).run(commentId)

  /**
   * Notable when a moderator removes somebody else's, routine when an author
   * removes their own.
   *
   * The two are different events wearing the same shape: one is moderation and
   * belongs in the band the log shows by default; the other is a person
   * changing their mind, which nobody needs alerting to.
   */
  logActivity({
    kind: 'comment.delete',
    area: 'moderation',
    severity: isOwnComment ? 'info' : 'notable',
    actor: me,
    subject: { kind: 'comment', id: commentId, label: comment.body.slice(0, 120) },
    summary: isOwnComment
      ? 'Deleted their own comment'
      : `Removed ${comment.username ?? 'a deleted account'}'s comment`,
    detail: {
      target_kind: comment.target_kind,
      target_id: comment.target_id,
      author: comment.username,
      // The whole thing, capped. Once the row is gone this is the only copy.
      body: comment.body.length > 500 ? `${comment.body.slice(0, 500)}…` : comment.body,
    },
  }, db)

  return { ok: true }
})

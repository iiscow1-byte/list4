import { getDb } from '~/server/db'
import { requireAccount, isModRole } from '~/server/utils/auth'
import { getThread } from '~/server/utils/forum'

/**
 * Moderate or like a thread.
 *
 * `like` is everybody's; `pin`, `lock` and `delete` are staff's, except that a
 * thread's own author may delete it. Grouped behind one verb because they are
 * four ways of changing one row and each needs the identical "does this thread
 * exist and may you touch it" preamble.
 *
 * Deleting cascades to the posts (see the schema's `ON DELETE CASCADE`), which
 * is the right answer here: a thread's replies are about the thread, and
 * leaving them behind as orphans would mean keeping a conversation whose
 * subject is gone.
 */
type Action = 'like' | 'unlike' | 'pin' | 'unpin' | 'lock' | 'unlock' | 'delete'
const ACTIONS = new Set<Action>(['like', 'unlike', 'pin', 'unpin', 'lock', 'unlock', 'delete'])

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad thread id.' })
  }

  const body = await readBody<{ action?: string }>(event) ?? {}
  const action = String(body.action ?? '') as Action
  if (!ACTIONS.has(action)) throw createError({ statusCode: 400, statusMessage: 'Unknown action.' })

  const db = getDb()
  const thread = db.prepare(
    `SELECT id, author_id FROM forum_threads WHERE id = ?`,
  ).get(id) as { id: number; author_id: number | null } | undefined
  if (!thread) throw createError({ statusCode: 404, statusMessage: 'No such thread.' })

  const staff = isModRole(me.role)
  const isAuthor = thread.author_id === me.id

  if (action === 'like' || action === 'unlike') {
    if (action === 'like') {
      db.prepare(
        `INSERT OR IGNORE INTO forum_thread_likes (thread_id, account_id) VALUES (?,?)`,
      ).run(id, me.id)
    } else {
      db.prepare(
        `DELETE FROM forum_thread_likes WHERE thread_id = ? AND account_id = ?`,
      ).run(id, me.id)
    }
    return { ok: true, thread: getThread(db, id, me.id) }
  }

  if (action === 'delete') {
    if (!staff && !isAuthor) {
      throw createError({ statusCode: 403, statusMessage: 'Not yours to delete.' })
    }
    db.prepare(`DELETE FROM forum_threads WHERE id = ?`).run(id)
    return { ok: true, deleted: true }
  }

  // Pinning and locking are editorial acts on somebody else's conversation.
  if (!staff) throw createError({ statusCode: 403, statusMessage: 'Moderators only.' })
  const column = action === 'pin' || action === 'unpin' ? 'pinned' : 'locked'
  const value = action === 'pin' || action === 'lock' ? 1 : 0
  db.prepare(`UPDATE forum_threads SET ${column} = ? WHERE id = ?`).run(value, id)
  return { ok: true, thread: getThread(db, id, me.id) }
})

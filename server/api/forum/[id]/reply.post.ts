import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'
import { assertVerified } from '~/server/utils/email-verify'
import { assertClean } from '~/server/utils/profanity-guard'
import { addReply, listPosts, getThread, recentCount, MAX_BODY, POSTS_PER_HOUR } from '~/server/utils/forum'

/**
 * Reply to a thread.
 *
 * Returns the whole thread and its posts rather than just the new one: a reply
 * changes the thread's reply count and its last-post time, and a client that
 * patched only its own message into the list would show stale numbers next to
 * it.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  assertVerified(me)
  enforceRateLimit(event, LIMITS.forumPost)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad thread id.' })
  }

  const body = await readBody<{ body?: string }>(event) ?? {}
  const text = String(body.body ?? '').trim().slice(0, MAX_BODY)
  if (text.length < 2) throw createError({ statusCode: 400, statusMessage: 'Say something.' })
  assertClean(text, 'Forum posts')

  const db = getDb()
  const thread = db.prepare(
    `SELECT id, title, author_id, locked FROM forum_threads WHERE id = ?`,
  ).get(id) as { id: number; title: string; author_id: number | null; locked: number } | undefined
  if (!thread) throw createError({ statusCode: 404, statusMessage: 'No such thread.' })
  if (thread.locked) throw createError({ statusCode: 403, statusMessage: 'That thread is locked.' })

  if (recentCount(db, 'forum_posts', me.id) >= POSTS_PER_HOUR) {
    throw createError({ statusCode: 429, statusMessage: 'Slow down a little.' })
  }

  addReply(db, thread, { id: me.id, username: me.username }, text)
  return { ok: true, thread: getThread(db, id, me.id), posts: listPosts(db, id) }
})

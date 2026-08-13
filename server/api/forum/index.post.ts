import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'
import { assertVerified } from '~/server/utils/email-verify'
import { assertClean } from '~/server/utils/profanity-guard'
import {
  isCategory, recentCount, getThread,
  MAX_TITLE, MAX_BODY, THREADS_PER_HOUR,
} from '~/server/utils/forum'

/**
 * Start a thread.
 *
 * `level_id` is optional and is what makes this a demon list's forum rather
 * than a generic board: a thread about a level carries the level, so the
 * level's own page can list what has been said about it and the thread can
 * print its rank without anybody typing it.
 *
 * The rate limit is a flood ceiling rather than a usage limit — ten new threads
 * in an hour is far more than anybody posts and far less than a script would.
 * Replies are limited separately and much more loosely, since a conversation is
 * supposed to be many messages.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  assertVerified(me)
  enforceRateLimit(event, LIMITS.forumThread)
  enforceRateLimit(event, LIMITS.forumPost)
  const body = await readBody<{
    title?: string; body?: string; category?: string; level_id?: number | string | null
  }>(event) ?? {}

  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE)
  if (title.length < 3) {
    throw createError({ statusCode: 400, statusMessage: 'A thread needs a title of at least 3 characters.' })
  }
  const text = String(body.body ?? '').trim().slice(0, MAX_BODY)
  if (text.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Say something in the first post.' })
  }
  assertClean(title, 'Thread titles')
  assertClean(text, 'Forum posts')

  const category = isCategory(body.category) ? body.category : 'general'

  const db = getDb()
  if (recentCount(db, 'forum_threads', me.id) >= THREADS_PER_HOUR) {
    throw createError({
      statusCode: 429,
      statusMessage: 'You\'ve started a lot of threads in the last hour. Try again shortly.',
    })
  }

  // A level that doesn't exist is dropped rather than refused: the link is a
  // convenience, and losing a whole post to a stale id would not be.
  let levelId: number | null = null
  const wanted = Number(body.level_id)
  if (Number.isInteger(wanted) && wanted > 0) {
    const hit = db.prepare(`SELECT id FROM levels WHERE id = ?`).get(wanted) as { id: number } | undefined
    levelId = hit?.id ?? null
  }

  const id = Number(db.prepare(
    `INSERT INTO forum_threads (category, title, body, author_id, level_id) VALUES (?,?,?,?,?)`,
  ).run(category, title, text, me.id, levelId).lastInsertRowid)

  return { ok: true, id, thread: getThread(db, id, me.id) }
})

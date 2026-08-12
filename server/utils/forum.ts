import type { DatabaseSync } from 'node:sqlite'
import { sendInboxMessage } from './inbox'

/**
 * The public forum.
 *
 * The site already had two places to write: comments, which are attached to one
 * level, and progress posts, which are attached to one attempt. Neither is a
 * place to start a conversation — "which of these two should I grind next" has
 * no level to hang off, and "here's my route for the wave at 74%" is about a
 * level but is not a comment on it.
 *
 * So: threads, with an optional `level_id` for the ones that *are* about a
 * level. That optional link is what keeps this from being a generic message
 * board bolted onto a demon list — a level's page can list the threads about
 * it, and a thread about a level carries its name and rank.
 *
 * ## The denormalised counters
 *
 * `reply_count` and `last_post_at` live on the thread so the index can order and
 * label the thread list without touching `forum_posts` at all. They are
 * maintained here and nowhere else, which is the only thing keeping them true.
 */

export const CATEGORIES = ['general', 'levels', 'progress', 'help', 'offtopic'] as const
export type ForumCategory = typeof CATEGORIES[number]

export const CATEGORY_LABELS: Record<ForumCategory, string> = {
  general: 'General',
  levels: 'Levels',
  progress: 'Progress',
  help: 'Help & advice',
  offtopic: 'Off topic',
}

export const MAX_TITLE = 140
export const MAX_BODY = 8000
/** New threads per account per hour. A flood ceiling, not a usage limit. */
export const THREADS_PER_HOUR = 10
export const POSTS_PER_HOUR = 60

export function isCategory(v: unknown): v is ForumCategory {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
}

/**
 * The columns every thread listing needs, including the author and the level.
 *
 * One string rather than repeated in three queries: the thread list, a single
 * thread and a level's threads all print the same row, and a column added to
 * one and missed in another shows up as a field that is mysteriously null on
 * one page.
 */
const THREAD_SELECT = `
  SELECT t.id, t.category, t.title, t.pinned, t.locked, t.reply_count,
         t.created_at, t.last_post_at, t.edited_at, t.level_id,
         a.username AS author_username,
         a.role     AS author_role,
         (a.avatar_blob IS NOT NULL) AS author_has_avatar,
         c.tag AS clan_tag, c.name AS clan_name, c.color AS clan_color,
         l.position AS level_position, l.name AS level_name,
         l.sheet_placement AS level_sheet_placement, l.gd_id AS level_gd_id,
         (SELECT COUNT(*) FROM forum_thread_likes fl WHERE fl.thread_id = t.id) AS likes
    FROM forum_threads t
    LEFT JOIN accounts a ON a.id = t.author_id
    LEFT JOIN clan_members cm ON cm.account_id = a.id
    LEFT JOIN clans        c  ON c.id = cm.clan_id
    LEFT JOIN levels       l  ON l.id = t.level_id
`

function shapeThread(r: any) {
  return {
    id: r.id,
    category: r.category as ForumCategory,
    title: r.title,
    body: r.body ?? undefined,
    pinned: !!r.pinned,
    locked: !!r.locked,
    reply_count: r.reply_count,
    likes: r.likes ?? 0,
    liked: !!r.liked,
    created_at: r.created_at,
    last_post_at: r.last_post_at,
    edited_at: r.edited_at,
    author: r.author_username
      ? {
          username: r.author_username,
          role: r.author_role,
          has_avatar: !!r.author_has_avatar,
          clan: r.clan_tag ? { tag: r.clan_tag, name: r.clan_name, color: r.clan_color } : null,
        }
      : null,
    level: r.level_id
      ? {
          id: r.level_id,
          position: r.level_position,
          sheet_placement: r.level_sheet_placement,
          name: r.level_name,
          gd_id: r.level_gd_id,
        }
      : null,
  }
}

export type ThreadSort = 'active' | 'new' | 'top'

const SORT_SQL: Record<ThreadSort, string> = {
  // Pinned first in every ordering: a pinned thread is pinned to the top of the
  // list, not to the top of one way of looking at it.
  active: 't.pinned DESC, t.last_post_at DESC',
  new:    't.pinned DESC, t.created_at DESC',
  top:    't.pinned DESC, likes DESC, t.reply_count DESC, t.last_post_at DESC',
}

export function listThreads(
  db: DatabaseSync,
  opts: {
    category?: ForumCategory | null
    levelId?: number | null
    authorId?: number | null
    search?: string
    sort?: ThreadSort
    limit?: number
    offset?: number
    viewerId?: number | null
  } = {},
) {
  const conds: string[] = []
  const params: any[] = []
  if (opts.category) { conds.push('t.category = ?'); params.push(opts.category) }
  if (opts.levelId)  { conds.push('t.level_id = ?'); params.push(opts.levelId) }
  if (opts.authorId) { conds.push('t.author_id = ?'); params.push(opts.authorId) }
  if (opts.search) {
    // Title and body both, because a thread is often findable by a level name
    // that only appears in what somebody wrote.
    conds.push('(t.title LIKE ? COLLATE NOCASE OR t.body LIKE ? COLLATE NOCASE)')
    params.push(`%${opts.search}%`, `%${opts.search}%`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30))
  const offset = Math.max(0, opts.offset ?? 0)

  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM forum_threads t ${where}`,
  ).get(...params) as { n: number }).n

  const rows = db.prepare(`
    ${THREAD_SELECT}
    ${where}
    ORDER BY ${SORT_SQL[opts.sort ?? 'active']}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  const items = rows.map(shapeThread)
  markLiked(db, items, opts.viewerId ?? null)
  return { total, items }
}

/** Which of these the viewer has liked — one query for the page, not one each. */
function markLiked(db: DatabaseSync, items: { id: number; liked: boolean }[], viewerId: number | null) {
  if (!viewerId || !items.length) return
  const ph = items.map(() => '?').join(',')
  const liked = new Set((db.prepare(
    `SELECT thread_id FROM forum_thread_likes WHERE account_id = ? AND thread_id IN (${ph})`,
  ).all(viewerId, ...items.map((i) => i.id)) as { thread_id: number }[]).map((r) => r.thread_id))
  for (const i of items) i.liked = liked.has(i.id)
}

export function getThread(db: DatabaseSync, id: number, viewerId: number | null = null) {
  const row = db.prepare(`${THREAD_SELECT} WHERE t.id = ?`).get(id) as any
  if (!row) return null
  const body = (db.prepare(`SELECT body FROM forum_threads WHERE id = ?`).get(id) as { body: string }).body
  const thread = { ...shapeThread(row), body }
  markLiked(db, [thread], viewerId)
  return thread
}

export function listPosts(db: DatabaseSync, threadId: number) {
  return (db.prepare(`
    SELECT p.id, p.body, p.created_at, p.edited_at,
           a.username AS author_username, a.role AS author_role,
           (a.avatar_blob IS NOT NULL) AS author_has_avatar,
           c.tag AS clan_tag, c.name AS clan_name, c.color AS clan_color
      FROM forum_posts p
      LEFT JOIN accounts a ON a.id = p.author_id
      LEFT JOIN clan_members cm ON cm.account_id = a.id
      LEFT JOIN clans        c  ON c.id = cm.clan_id
     WHERE p.thread_id = ?
     ORDER BY p.created_at ASC, p.id ASC
  `).all(threadId) as any[]).map((r) => ({
    id: r.id,
    body: r.body,
    created_at: r.created_at,
    edited_at: r.edited_at,
    author: r.author_username
      ? {
          username: r.author_username,
          role: r.author_role,
          has_avatar: !!r.author_has_avatar,
          clan: r.clan_tag ? { tag: r.clan_tag, name: r.clan_name, color: r.clan_color } : null,
        }
      : null,
  }))
}

/** How many threads / posts this account has started in the last hour. */
export function recentCount(db: DatabaseSync, table: 'forum_threads' | 'forum_posts', accountId: number): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM ${table}
      WHERE author_id = ? AND created_at > datetime('now', '-1 hour')`,
  ).get(accountId) as { n: number }).n
}

/**
 * Add a reply, keep the thread's counters true, and tell the people in it.
 *
 * The notification is the part that makes a forum work: a reply nobody is told
 * about is a reply nobody answers. Everyone who has written in the thread is
 * told once — including the thread's author, who otherwise only hears about
 * replies to their own replies — and never the person doing the replying.
 */
export function addReply(
  db: DatabaseSync,
  thread: { id: number; title: string; author_id: number | null },
  author: { id: number; username: string },
  body: string,
): number {
  let postId = 0
  db.exec('BEGIN')
  try {
    postId = Number(db.prepare(
      `INSERT INTO forum_posts (thread_id, author_id, body) VALUES (?,?,?)`,
    ).run(thread.id, author.id, body).lastInsertRowid)
    db.prepare(
      `UPDATE forum_threads
          SET reply_count = reply_count + 1, last_post_at = datetime('now')
        WHERE id = ?`,
    ).run(thread.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  const participants = new Set<number>()
  if (thread.author_id) participants.add(thread.author_id)
  for (const r of db.prepare(
    `SELECT DISTINCT author_id FROM forum_posts WHERE thread_id = ? AND author_id IS NOT NULL`,
  ).all(thread.id) as { author_id: number }[]) {
    participants.add(r.author_id)
  }
  participants.delete(author.id)

  for (const id of participants) {
    sendInboxMessage(db, id, {
      kind: 'forum_reply',
      subject: `${author.username} replied to “${thread.title}”`,
      body: body.slice(0, 300),
      related_kind: 'forum_thread',
      related_id: thread.id,
      sent_by: author.id,
    })
  }
  return postId
}

import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { listThreads, isCategory, CATEGORIES, type ThreadSort } from '~/server/utils/forum'

/**
 * The thread list.
 *
 * Public — the forum is one, and a discussion board you have to sign in to read
 * is a discussion board nobody finds. Signing in is what it takes to *write*.
 *
 * The per-category counts come back with it so the category filter can print
 * them without a second request; they are five cheap grouped counts over one
 * table.
 */
const SORTS = new Set<ThreadSort>(['active', 'new', 'top'])

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const db = getDb()
  const me = getCurrentAccount(event)

  const sort = (typeof q.sort === 'string' && SORTS.has(q.sort as ThreadSort) ? q.sort : 'active') as ThreadSort
  const category = isCategory(q.category) ? q.category : null
  const levelId = Number(q.level_id)
  const search = String(q.q ?? '').trim()

  const { total, items } = listThreads(db, {
    category,
    levelId: Number.isInteger(levelId) && levelId > 0 ? levelId : null,
    search: search || undefined,
    sort,
    limit: Math.min(50, Math.max(1, Number(q.limit) || 30)),
    offset: Math.max(0, Number(q.offset) || 0),
    viewerId: me?.id ?? null,
  })

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<string, number>
  for (const r of db.prepare(
    `SELECT category, COUNT(*) AS n FROM forum_threads GROUP BY category`,
  ).all() as { category: string; n: number }[]) {
    counts[r.category] = r.n
  }

  return { total, items, counts, sort, category, signedIn: !!me }
})

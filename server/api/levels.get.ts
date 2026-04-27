import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(500, Math.max(1, Number(q.pageSize) || 100))
  const search = typeof q.search === 'string' ? q.search.trim() : ''
  const difficulty = typeof q.difficulty === 'string' ? q.difficulty.trim() : ''
  const offset = (page - 1) * pageSize

  const db = getDb()
  const conds: string[] = []
  const params: any[] = []
  if (search) {
    conds.push('(name LIKE ? COLLATE NOCASE)')
    params.push(`%${search}%`)
  }
  if (difficulty) {
    conds.push('difficulty = ?')
    params.push(difficulty)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const total = (db.prepare(`SELECT COUNT(*) as n FROM levels ${where}`).get(...params) as { n: number }).n
  const rows = db
    .prepare(
      `SELECT position, name, difficulty, points, gddl_tier
       FROM levels ${where}
       ORDER BY position ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items: rows }
})

import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(500, Math.max(1, Number(q.pageSize) || 100))
  const search = typeof q.search === 'string' ? q.search.trim() : ''
  const offset = (page - 1) * pageSize

  const conds: string[] = []
  const params: any[] = []
  if (search) {
    conds.push('(name LIKE ? COLLATE NOCASE)')
    params.push(`%${search}%`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const db = getDb()
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM awaiting_levels ${where}`).get(...params) as { n: number }).n
  const items = db
    .prepare(
      `SELECT id, name, gd_id, gddl_tier, difficulty, main_skillset, approved_at
       FROM awaiting_levels ${where}
       ORDER BY approved_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items }
})

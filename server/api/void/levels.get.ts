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
    const asPos = Number(search.replace(/^#/, ''))
    if (Number.isInteger(asPos) && asPos > 0) {
      conds.push('(name LIKE ? COLLATE NOCASE OR position = ?)')
      params.push(`%${search}%`, asPos)
    } else {
      conds.push('(name LIKE ? COLLATE NOCASE)')
      params.push(`%${search}%`)
    }
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const db = getDb()
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM void_levels ${where}`).get(...params) as { n: number }).n
  const items = db
    .prepare(
      `SELECT position, name, demon_ranking, days
       FROM void_levels ${where}
       ORDER BY position ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items }
})

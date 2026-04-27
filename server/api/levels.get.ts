import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50))
  const search = typeof q.search === 'string' ? q.search.trim() : ''
  const offset = (page - 1) * pageSize

  const db = getDb()
  let where = ''
  let params: any[] = []
  if (search) {
    where = 'WHERE name LIKE ? COLLATE NOCASE OR creator LIKE ? COLLATE NOCASE'
    const like = `%${search}%`
    params = [like, like]
  }

  const total = (db.prepare(`SELECT COUNT(*) as n FROM levels ${where}`).get(...params) as { n: number }).n
  const rows = db
    .prepare(
      `SELECT id, position, name, creator, verifier, min_percent
       FROM levels ${where}
       ORDER BY position ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items: rows }
})

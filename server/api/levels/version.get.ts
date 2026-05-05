import { getDb } from '~/server/db'

export default defineEventHandler(() => {
  const db = getDb()
  const row = db
    .prepare('SELECT COUNT(*) AS cnt, MAX(id) AS maxid FROM levels WHERE permanent = 1')
    .get() as { cnt: number; maxid: number | null }
  return { stamp: (row.cnt ?? 0) * 1_000_000 + (row.maxid ?? 0) }
})

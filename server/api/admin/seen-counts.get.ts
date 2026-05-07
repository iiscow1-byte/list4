import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const account = requireMod(event)
  const db = getDb()
  const rows = db
    .prepare(`SELECT tab_id, seen FROM admin_seen_counts WHERE account_id = ?`)
    .all(account.id) as { tab_id: string; seen: number }[]
  const result: Record<string, number> = {}
  for (const row of rows) result[row.tab_id] = row.seen
  return result
})

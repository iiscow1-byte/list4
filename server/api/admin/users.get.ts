import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const q = getQuery(event)
  const search = typeof q.search === 'string' ? q.search.trim() : ''

  const db = getDb()
  let rows
  if (search) {
    rows = db.prepare(
      `SELECT id, username, role, claimed_player, created_at, banned_at, banned_reason
         FROM accounts
        WHERE username LIKE ? COLLATE NOCASE OR claimed_player LIKE ? COLLATE NOCASE
        ORDER BY created_at DESC LIMIT 200`,
    ).all(`%${search}%`, `%${search}%`)
  } else {
    rows = db.prepare(
      `SELECT id, username, role, claimed_player, created_at, banned_at, banned_reason
         FROM accounts ORDER BY created_at DESC LIMIT 200`,
    ).all()
  }
  return { items: rows }
})

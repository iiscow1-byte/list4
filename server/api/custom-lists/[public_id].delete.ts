import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/** Owner-only delete. Items cascade. */
export default defineEventHandler((event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')

  const db = getDb()
  const row = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (row.owner_account_id !== account.id) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list' })
  }

  db.prepare(`DELETE FROM custom_lists WHERE id = ?`).run(row.id)
  return { ok: true }
})

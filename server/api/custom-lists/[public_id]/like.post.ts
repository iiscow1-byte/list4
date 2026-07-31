import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * Toggle a like on a public list. `custom_lists.likes` is kept in sync in the
 * same transaction so the gallery can sort on it without a join.
 */
export default defineEventHandler((event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')

  const db = getDb()
  const list = db.prepare(
    `SELECT id, is_public, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; is_public: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!list.is_public && list.owner_account_id !== account.id) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }

  const existing = db.prepare(
    `SELECT 1 AS n FROM custom_list_likes WHERE list_id = ? AND account_id = ?`,
  ).get(list.id, account.id)

  db.exec('BEGIN')
  try {
    if (existing) {
      db.prepare(`DELETE FROM custom_list_likes WHERE list_id = ? AND account_id = ?`)
        .run(list.id, account.id)
    } else {
      db.prepare(`INSERT INTO custom_list_likes (list_id, account_id) VALUES (?, ?)`)
        .run(list.id, account.id)
    }
    // Recount rather than ±1 so the denormalised value can't drift.
    db.prepare(
      `UPDATE custom_lists
          SET likes = (SELECT COUNT(*) FROM custom_list_likes WHERE list_id = ?)
        WHERE id = ?`,
    ).run(list.id, list.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  const likes = (db.prepare(`SELECT likes FROM custom_lists WHERE id = ?`)
    .get(list.id) as { likes: number }).likes

  return { ok: true, liked: !existing, likes }
})

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * The signed-in user's own lists, newest-updated first.
 *
 * Shaped like `/api/custom-lists/public` — same columns, same cover thumbnails
 * — so the gallery can render "My lists" with the card it already has instead
 * of a second, thinner layout. `is_public` is the one extra field: these are
 * the only lists whose owner is allowed to see the unpublished ones.
 */
export default defineEventHandler((event) => {
  const account = requireAccount(event)
  const db = getDb()

  const lists = db.prepare(
    `SELECT cl.id, cl.public_id, cl.title, cl.description, cl.likes, cl.is_public,
            cl.created_at, cl.updated_at,
            a.username AS owner_username,
            (SELECT COUNT(*) FROM custom_list_items i WHERE i.list_id = cl.id) AS item_count,
            (SELECT 1 FROM custom_list_likes k WHERE k.list_id = cl.id AND k.account_id = ?) AS liked_by_me
       FROM custom_lists cl
       LEFT JOIN accounts a ON a.id = cl.owner_account_id
      WHERE cl.owner_account_id = ?
      ORDER BY cl.updated_at DESC, cl.id DESC`,
  ).all(account.id, account.id) as any[]

  const covers = db.prepare(
    `SELECT i.gd_id FROM custom_list_items i
       JOIN custom_lists c ON c.id = i.list_id
      WHERE c.public_id = ? AND i.gd_id IS NOT NULL
      ORDER BY i.sort_order ASC LIMIT 3`,
  )

  return {
    lists: lists.map((l) => ({
      ...l,
      liked_by_me: !!l.liked_by_me,
      cover_gd_ids: (covers.all(l.public_id) as { gd_id: number }[]).map((r) => r.gd_id),
    })),
  }
})

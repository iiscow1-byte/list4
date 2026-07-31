import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/** The signed-in user's own lists, newest-updated first. */
export default defineEventHandler((event) => {
  const account = requireAccount(event)
  const db = getDb()
  const lists = db.prepare(
    `SELECT cl.id, cl.public_id, cl.title, cl.description, cl.created_at, cl.updated_at,
            (SELECT COUNT(*) FROM custom_list_items i WHERE i.list_id = cl.id) AS item_count
       FROM custom_lists cl
      WHERE cl.owner_account_id = ?
      ORDER BY cl.updated_at DESC, cl.id DESC`,
  ).all(account.id)
  return { lists }
})

import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'

/**
 * The public list gallery. Only lists their owner explicitly published show
 * up. `liked_by_me` lets the client render the like button in the right
 * state without a second round-trip.
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const sort = q.sort === 'new' ? 'new' : 'top'
  const limit = Math.max(1, Math.min(Number(q.limit) || 40, 100))
  const search = String(q.search ?? '').trim().slice(0, 100)

  const me = getCurrentAccount(event)
  const db = getDb()

  const conds = ['cl.is_public = 1']
  const params: any[] = []
  if (search) {
    conds.push('cl.title LIKE ? COLLATE NOCASE')
    params.push(`%${search}%`)
  }

  const order = sort === 'new'
    ? 'cl.updated_at DESC, cl.id DESC'
    : 'cl.likes DESC, cl.updated_at DESC'

  const lists = db.prepare(
    `SELECT cl.public_id, cl.title, cl.description, cl.likes, cl.updated_at,
            cl.accent_color, cl.icon_url,
            a.username AS owner_username,
            (SELECT COUNT(*) FROM custom_list_items i WHERE i.list_id = cl.id) AS item_count,
            ${me ? '(SELECT 1 FROM custom_list_likes k WHERE k.list_id = cl.id AND k.account_id = ?)' : 'NULL'} AS liked_by_me
       FROM custom_lists cl
       LEFT JOIN accounts a ON a.id = cl.owner_account_id
      WHERE ${conds.join(' AND ')}
      ORDER BY ${order}
      LIMIT ?`,
  ).all(...(me ? [me.id] : []), ...params, limit) as any[]

  // A few cover thumbnails per list so the gallery cards aren't bare text.
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

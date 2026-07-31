import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'

/**
 * Records on a list. Approved ones are public; pending and rejected ones are
 * only visible to whoever can moderate the list (its owner, or a site admin).
 */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const status = String(getQuery(event).status ?? 'approved')

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, is_public FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; is_public: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const me = getCurrentAccount(event)
  const canModerate = canEditList(db, list, me)
  if (!list.is_public && !canModerate) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }
  if (status !== 'approved' && !canModerate) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list.' })
  }

  const records = db.prepare(
    `SELECT r.id, r.item_id, r.player_name, r.percent, r.hz, r.video, r.mobile, r.note,
            r.status, r.reject_reason, r.submitted_at,
            i.name AS level_name, i.sort_order,
            a.username AS submitted_by_username
       FROM custom_list_records r
       JOIN custom_list_items i ON i.id = r.item_id
       LEFT JOIN accounts a ON a.id = r.submitted_by
      WHERE r.list_id = ? AND r.status = ?
      ORDER BY r.submitted_at DESC, r.id DESC
      LIMIT 500`,
  ).all(list.id, status)

  const pendingCount = canModerate
    ? (db.prepare(
        `SELECT COUNT(*) AS n FROM custom_list_records WHERE list_id = ? AND status = 'pending'`,
      ).get(list.id) as { n: number }).n
    : 0

  return { records, can_moderate: canModerate, pending_count: pendingCount }
})

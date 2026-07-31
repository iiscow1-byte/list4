import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'

/** A custom list's own changelog: levels added, moved, or removed. */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const limit = Math.max(1, Math.min(Number(getQuery(event).limit) || 200, 500))

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, is_public FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; is_public: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const me = getCurrentAccount(event)
  if (!list.is_public && !canEditList(db, list, me)) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }

  const changes = db.prepare(
    `SELECT c.id, c.item_id, c.level_name, c.kind, c.from_rank, c.to_rank, c.changed_at,
            a.username AS changed_by_username,
            i.sort_order AS current_sort_order
       FROM custom_list_changes c
       LEFT JOIN accounts a ON a.id = c.changed_by
       LEFT JOIN custom_list_items i ON i.id = c.item_id
      WHERE c.list_id = ?
      ORDER BY c.changed_at DESC, c.id DESC
      LIMIT ?`,
  ).all(list.id, limit) as any[]

  // Group by UTC day, the same shape the site changelog uses.
  const days: { date: string; changes: any[] }[] = []
  for (const c of changes) {
    const date = String(c.changed_at).slice(0, 10)
    const last = days[days.length - 1]
    if (last && last.date === date) last.changes.push(c)
    else days.push({ date, changes: [c] })
  }

  return { days }
})

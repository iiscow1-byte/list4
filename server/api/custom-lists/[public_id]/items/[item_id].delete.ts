import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { loadList } from '~/server/utils/custom-lists'

/**
 * Drop one level from a list, from the list page itself.
 *
 * The remaining rows are renumbered so ranks stay contiguous, and the removal
 * is logged like any other change. Records on the removed row cascade away
 * with it — that's the same behaviour as removing it in the builder.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const itemId = Number(getRouterParam(event, 'item_id'))

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list' })
  }

  const row = db.prepare(
    `SELECT id, name, sort_order FROM custom_list_items WHERE id = ? AND list_id = ?`,
  ).get(itemId, list.id) as { id: number; name: string; sort_order: number } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'That level is not on this list.' })

  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM custom_list_items WHERE id = ? AND list_id = ?`).run(itemId, list.id)
    // Close the gap so ranks stay 1..n with no hole where the row was.
    db.prepare(
      `UPDATE custom_list_items SET sort_order = sort_order - 1
        WHERE list_id = ? AND sort_order > ?`,
    ).run(list.id, row.sort_order)
    db.prepare(
      `INSERT INTO custom_list_changes
         (list_id, item_id, level_name, kind, from_rank, to_rank, changed_by)
       VALUES (?, NULL, ?, 'remove', ?, NULL, ?)`,
    ).run(list.id, row.name, row.sort_order + 1, account.id)
    db.prepare(`UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?`).run(list.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { ok: true, list: loadList(db, list.id) }
})

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { loadList } from '~/server/utils/custom-lists'

/**
 * Move one level to a new rank, without resaving the whole list.
 *
 * The builder's full save (`PATCH /api/custom-lists/:id`) reconciles every row
 * and rewrites the changelog; that's the right shape when someone has been
 * editing for a while, but far too much machinery for dragging one row two
 * places up on the list page itself. This does the single move and logs the
 * single change.
 *
 * Ranks are 1-based and clamp to the list, so a drop past the end lands at the
 * end rather than erroring.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{ item_id?: number; to_rank?: number }>(event) ?? {}

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, follow_all_order FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; follow_all_order: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list' })
  }
  // Ordering is derived from ALL placements at read time, so a manual move
  // would be overwritten the moment the list is read again. Refusing is
  // honest; silently accepting and discarding it is not.
  if (list.follow_all_order) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This list orders itself by ALL placements. Turn that off in settings to reorder by hand.',
    })
  }

  const itemId = Number(body.item_id)
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'item_id is required' })
  }

  // Read the whole ordering once — a custom list is capped at 250 rows, so
  // reordering in memory and writing back is simpler and cheaper than a
  // shifting UPDATE with a hole in the middle.
  const items = db.prepare(
    `SELECT id, name, sort_order FROM custom_list_items
      WHERE list_id = ? ORDER BY sort_order ASC, id ASC`,
  ).all(list.id) as { id: number; name: string; sort_order: number }[]

  const fromIdx = items.findIndex((i) => i.id === itemId)
  if (fromIdx === -1) throw createError({ statusCode: 404, statusMessage: 'That level is not on this list.' })

  const wanted = Number(body.to_rank)
  if (!Number.isFinite(wanted)) {
    throw createError({ statusCode: 400, statusMessage: 'to_rank is required' })
  }
  const toIdx = Math.max(0, Math.min(items.length - 1, Math.round(wanted) - 1))
  if (toIdx === fromIdx) {
    return { ok: true, moved: false, from: fromIdx + 1, to: toIdx + 1, list: loadList(db, list.id) }
  }

  const moved = items[fromIdx]!
  const reordered = items.slice()
  reordered.splice(fromIdx, 1)
  reordered.splice(toIdx, 0, moved)

  const upd = db.prepare(`UPDATE custom_list_items SET sort_order = ? WHERE id = ? AND list_id = ?`)
  const logChange = db.prepare(
    `INSERT INTO custom_list_changes
       (list_id, item_id, level_name, kind, from_rank, to_rank, changed_by)
     VALUES (?,?,?,'move',?,?,?)`,
  )

  db.exec('BEGIN')
  try {
    // sort_order has no UNIQUE constraint, so a straight rewrite is safe —
    // only the rows whose index actually changed are touched.
    reordered.forEach((row, i) => {
      if (row.sort_order !== i) upd.run(i, row.id, list.id)
    })
    logChange.run(list.id, moved.id, moved.name, fromIdx + 1, toIdx + 1, account.id)
    db.prepare(`UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?`).run(list.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { ok: true, moved: true, from: fromIdx + 1, to: toIdx + 1, list: loadList(db, list.id) }
})

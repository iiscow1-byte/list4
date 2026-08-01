import type { DatabaseSync } from 'node:sqlite'
import { resolveAllLevel } from './custom-lists'

/**
 * Place an approved suggestion onto the list.
 *
 * `sort_order` is 0-based and dense, so inserting mid-list means shifting
 * everything below down by one first. A suggestion with no requested rank goes
 * to the bottom — the safe default, since whoever approved it can drag it
 * afterwards but can't undo a wrong guess as easily.
 */
export function appendApprovedLevel(
  db: DatabaseSync,
  listId: number,
  pendingId: number,
  actorId: number,
): void {
  const p = db.prepare(
    `SELECT level_id, name, gd_id, creator, verifier, verification_url, suggested_rank
       FROM custom_list_pending WHERE id = ? AND list_id = ?`,
  ).get(pendingId, listId) as any
  if (!p) return

  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM custom_list_items WHERE list_id = ?`,
  ).get(listId) as { n: number }).n

  const target = p.suggested_rank != null
    ? Math.max(0, Math.min(count, p.suggested_rank - 1))
    : count

  db.prepare(
    `UPDATE custom_list_items SET sort_order = sort_order + 1
      WHERE list_id = ? AND sort_order >= ?`,
  ).run(listId, target)

  // A suggestion usually names a level the ALL list already has; adopt it so
  // the approved row follows the main list rather than freezing whatever the
  // submitter typed.
  const levelId = p.level_id ?? resolveAllLevel(db, { gdId: p.gd_id, name: p.name })

  const info = db.prepare(
    `INSERT INTO custom_list_items
       (list_id, sort_order, level_id, name, gd_id, creator, verifier, verification_url)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(listId, target, levelId, p.name, p.gd_id, p.creator, p.verifier, p.verification_url)

  db.prepare(
    `INSERT INTO custom_list_changes
       (list_id, item_id, level_name, kind, from_rank, to_rank, changed_by)
     VALUES (?,?,?,'add',NULL,?,?)`,
  ).run(listId, Number(info.lastInsertRowid), p.name, target + 1, actorId)
}

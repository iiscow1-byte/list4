import type { DatabaseSync } from 'node:sqlite'
import { resyncPlacementsForMove } from './placement-sync'

/**
 * Moving one level, in one place.
 *
 * Four things have to happen together and every one of them has been a bug at
 * some point: the row can't collide with a position another row still holds,
 * the range it passes through has to close up behind it, the placement numbers
 * belong to the slots rather than to the levels, and the changelog wants one
 * entry per level per day rather than one per hop. Endpoints that reimplemented
 * this got some subset right.
 */
const STASH = -1_000_000_000

export type MoveResult = { from: number; to: number; moved: boolean }

/**
 * Move whatever sits at `fromPos` to `toPos`, shifting the rows in between.
 * Caller is responsible for `recomputePoints` — several moves in a row should
 * only pay for it once.
 */
export function moveLevel(
  db: DatabaseSync,
  fromPos: number,
  toPos: number,
  accountId: number | null,
): MoveResult {
  if (fromPos === toPos) return { from: fromPos, to: toPos, moved: false }

  const existing = db.prepare(`SELECT id FROM levels WHERE position = ?`)
    .get(fromPos) as { id: number } | undefined
  if (!existing) throw new Error('No level sits at that position.')

  const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
  const target = Math.max(1, Math.min(toPos, maxPos))
  if (target === fromPos) return { from: fromPos, to: fromPos, moved: false }

  db.exec('BEGIN')
  try {
    // 1. Stash the row being moved out of range so it can't collide.
    db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(STASH, fromPos)

    // 2. Shift the affected range using negate-then-flip.
    if (target < fromPos) {
      db.prepare(
        `UPDATE levels SET position = -(position + 1) WHERE position >= ? AND position < ?`,
      ).run(target, fromPos)
    } else {
      db.prepare(
        `UPDATE levels SET position = -(position - 1) WHERE position > ? AND position <= ?`,
      ).run(fromPos, target)
    }
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0 AND position != ?`).run(STASH)

    // 3. Land it, and clear the tentative flag — a deliberate position change
    //    means the placement is no longer uncertain.
    db.prepare(`UPDATE levels SET position = ?, tentative_placement = 0 WHERE position = ?`)
      .run(target, STASH)

    // 4. Placement numbers belong to slots, not to levels.
    resyncPlacementsForMove(db, fromPos, target)

    // 5. Already moved today? Update that entry so the changelog shows one
    //    condensed #X → #Y rather than N hops.
    const existingToday = db.prepare(
      `SELECT id FROM position_history
        WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now')
        ORDER BY changed_at ASC, id ASC LIMIT 1`,
    ).get(existing.id) as { id: number } | undefined
    if (existingToday) {
      db.prepare(
        `UPDATE position_history SET to_position = ?, changed_at = datetime('now'), changed_by = ? WHERE id = ?`,
      ).run(target, accountId, existingToday.id)
      db.prepare(
        `DELETE FROM position_history
          WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now') AND id != ?`,
      ).run(existing.id, existingToday.id)
    } else {
      db.prepare(
        `INSERT INTO position_history (level_id, from_position, to_position, changed_by)
         VALUES (?, ?, ?, ?)`,
      ).run(existing.id, fromPos, target, accountId)
    }

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { from: fromPos, to: target, moved: true }
}

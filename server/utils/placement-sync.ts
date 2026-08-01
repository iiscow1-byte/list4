import type { DatabaseSync } from 'node:sqlite'

/**
 * Keeping `sheet_placement` consistent with `position`.
 *
 * `position` is the internal ordering and the URL key; `sheet_placement` is the
 * number the site actually prints. The two diverge in *value* (levels that
 * appear on several sheet tabs collapse into one row, so the sheet ends at
 * #54184 while positions end at 54174) but they must never diverge in *order*:
 * read down the list by position and the placements have to climb.
 *
 * A placement number belongs to a slot in the list, not to the level sitting in
 * it. Moving a level rotates which level occupies each slot in the affected
 * range, so the numbers stay put and the levels move between them. Nothing did
 * that: every position-mutating endpoint rewrote `position` and left
 * `sheet_placement` glued to the row, so a moved level kept printing its old
 * number and the whole range below it was off by one.
 *
 * The repair is the same operation in both directions: take the placement
 * numbers present in a range, sort them, and hand them back out in position
 * order. The multiset of numbers is preserved exactly — none invented, none
 * lost — so a range that was already consistent is left untouched.
 */

/**
 * Re-attach placement numbers to slots across `[lo, hi]` (inclusive, in
 * positions). Omit the bounds to sweep the whole list.
 *
 * Rows with no placement keep having none: a level the sheet doesn't list must
 * not start printing a number the sheet doesn't back. They simply don't take
 * part in the redistribution.
 *
 * @returns how many rows actually changed.
 */
export function resyncPlacements(db: DatabaseSync, lo?: number, hi?: number): number {
  const bounded = Number.isInteger(lo) && Number.isInteger(hi)
  const rows = (bounded
    ? db.prepare(
        `SELECT id, position, sheet_placement FROM levels
          WHERE position BETWEEN ? AND ?
          ORDER BY position ASC`,
      ).all(lo, hi)
    : db.prepare(
        `SELECT id, position, sheet_placement FROM levels ORDER BY position ASC`,
      ).all()
  ) as { id: number; position: number; sheet_placement: number | null }[]

  // Only the rows carrying a number take part, and the numbers they collectively
  // hold are exactly the numbers they'll collectively hold afterwards.
  const holders = rows.filter((r) => r.sheet_placement != null)
  if (holders.length < 2) return 0

  const numbers = holders.map((r) => r.sheet_placement as number).sort((a, b) => a - b)

  const upd = db.prepare(`UPDATE levels SET sheet_placement = ? WHERE id = ?`)
  let changed = 0
  holders.forEach((row, i) => {
    const want = numbers[i]!
    if (row.sheet_placement !== want) {
      upd.run(want, row.id)
      changed++
    }
  })
  return changed
}

/**
 * Resync the range a single move disturbed, widened by one slot on each side so
 * a move that lands next to an untouched neighbour still reads correctly.
 */
export function resyncPlacementsForMove(db: DatabaseSync, fromPos: number, toPos: number): number {
  const lo = Math.max(1, Math.min(fromPos, toPos) - 1)
  const hi = Math.max(fromPos, toPos) + 1
  return resyncPlacements(db, lo, hi)
}

/**
 * How many rows currently print a placement that disagrees with their position.
 * Read-only — used to report the damage before and after a repair.
 */
export function countPlacementBreaks(db: DatabaseSync): number {
  const rows = db.prepare(
    `SELECT sheet_placement FROM levels
      WHERE sheet_placement IS NOT NULL
      ORDER BY position ASC`,
  ).all() as { sheet_placement: number }[]

  let breaks = 0
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.sheet_placement < rows[i - 1]!.sheet_placement) breaks++
  }
  return breaks
}

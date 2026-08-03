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

export type MoveResult = {
  from: number
  to: number
  moved: boolean
  /** Set only when the move changed the level's tier. */
  tier_from?: string | null
  tier_to?: string | null
}

/**
 * The tier a level takes by landing in a slot.
 *
 * The list is ordered by difficulty, so a slot already *means* a tier — the one
 * its neighbours are in. A level dragged from #4,000 to #300 has been judged
 * that much harder, and leaving it labelled with the tier it had at #4,000
 * contradicts the position it was just given. This reads the tier back off the
 * destination and hands it to the level.
 *
 * Both neighbours are consulted rather than just one, because a slot between
 * two different tiers is genuinely a boundary. There the nearer neighbour wins,
 * and a tie goes to the one above: the level was placed *below* it, which is
 * the neighbour whose band it was moved into.
 *
 * Levels with no tier either side (the bottom of an unrated stretch) return
 * null — an absent answer, not a guess.
 */
export function tierForSlot(
  db: DatabaseSync,
  position: number,
  excludeLevelId: number,
): string | null {
  const above = db.prepare(
    `SELECT position, gddl_tier FROM levels
      WHERE position < ? AND id != ? AND gddl_tier IS NOT NULL AND gddl_tier != ''
      ORDER BY position DESC LIMIT 1`,
  ).get(position, excludeLevelId) as { position: number; gddl_tier: string } | undefined
  const below = db.prepare(
    `SELECT position, gddl_tier FROM levels
      WHERE position > ? AND id != ? AND gddl_tier IS NOT NULL AND gddl_tier != ''
      ORDER BY position ASC LIMIT 1`,
  ).get(position, excludeLevelId) as { position: number; gddl_tier: string } | undefined

  if (!above && !below) return null
  if (!above) return below!.gddl_tier
  if (!below) return above.gddl_tier
  if (above.gddl_tier === below.gddl_tier) return above.gddl_tier

  const distAbove = position - above.position
  const distBelow = below.position - position
  return distBelow < distAbove ? below.gddl_tier : above.gddl_tier
}

export type MoveOptions = {
  /**
   * Leave `gddl_tier` alone. For the rare deliberate outlier — a level parked
   * where the curators want it that isn't the difficulty of its neighbours.
   */
  keepTier?: boolean
}

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
  opts: MoveOptions = {},
): MoveResult {
  if (fromPos === toPos) return { from: fromPos, to: toPos, moved: false }

  const existing = db.prepare(`SELECT id, gddl_tier FROM levels WHERE position = ?`)
    .get(fromPos) as { id: number; gddl_tier: string | null } | undefined
  if (!existing) throw new Error('No level sits at that position.')

  const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
  const target = Math.max(1, Math.min(toPos, maxPos))
  if (target === fromPos) return { from: fromPos, to: fromPos, moved: false }

  let tierFrom: string | null = null
  let tierTo: string | null = null

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

    // 5. So does the tier — the slot is a statement about difficulty, and the
    //    level now makes it. Read after the shift, so the neighbours are the
    //    ones it actually ended up between.
    if (!opts.keepTier) {
      const landed = tierForSlot(db, target, existing.id)
      if (landed && landed !== existing.gddl_tier) {
        db.prepare(`UPDATE levels SET gddl_tier = ? WHERE id = ?`).run(landed, existing.id)
        tierFrom = existing.gddl_tier
        tierTo = landed
      }
    }

    // 6. Already moved today? Update that entry so the changelog shows one
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

  return tierTo
    ? { from: fromPos, to: target, moved: true, tier_from: tierFrom, tier_to: tierTo }
    : { from: fromPos, to: target, moved: true }
}

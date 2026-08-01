import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { recordPlacement } from '~/server/utils/changes'

const STASH = -1_000_000_000

/**
 * Batch-place all awaiting levels that have a placement_suggestion, then
 * approve all pending movements. Levels are placed in descending order of
 * placement_suggestion so higher-position inserts don't shift the slots for
 * lower-position ones.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const db = getDb()

  // --- Awaiting levels ---
  const awaitingItems = db.prepare(
    `SELECT * FROM awaiting_levels WHERE placement_suggestion IS NOT NULL ORDER BY placement_suggestion DESC`,
  ).all() as any[]

  let placedCount = 0
  for (const sub of awaitingItems) {
    const placement = sub.placement_suggestion as number
    const submitterId: number | null = sub.pending_id
      ? (db.prepare(`SELECT submitted_by FROM pending_levels WHERE id = ?`).get(sub.pending_id) as { submitted_by: number | null } | undefined)?.submitted_by ?? null
      : null

    db.exec('BEGIN')
    try {
      const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
      const insertPos = Math.min(placement, maxPos + 1)
      db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ?`).run(insertPos)
      db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
      const result = db.prepare(
        `INSERT INTO levels
          (position, name, gd_id, gddl_tier, difficulty, main_skillset, verify_date,
           verification, verification_url, year_verified, category, source_tab,
           creator, permanent, enjoyment, pov_placement, placement_source, submitted_by,
           same_as_above, duplicate_of_id, is_alternate, alternate_of_id, rated,
           site_only)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', 'ALL Submission', NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 1)`,
      ).run(
        insertPos, sub.name, sub.gd_id,
        sub.gddl_tier, sub.difficulty, sub.main_skillset, sub.verify_date,
        sub.verification, sub.verification_url,
        sub.verify_date && /^\d{4}/.test(sub.verify_date) ? Number(sub.verify_date.slice(0, 4)) : null,
        sub.enjoyment, insertPos,
        sub.placement_source ?? 'All Levels List',
        submitterId,
        sub.same_as_above ? 1 : 0,
        sub.duplicate_of_id ?? null,
        sub.is_alternate ? 1 : 0,
        sub.alternate_of_id ?? null,
        sub.rated ?? null,
      )
      recordPlacement(db, Number(result.lastInsertRowid), insertPos, account.id)
      db.prepare(`DELETE FROM awaiting_levels WHERE id = ?`).run(sub.id)
      db.exec('COMMIT')
      placedCount++
    } catch {
      db.exec('ROLLBACK')
      // Skip levels that fail — continue with remaining.
    }
  }

  // --- Pending movements ---
  const movements = db.prepare(
    `SELECT * FROM pending_movements WHERE status = 'pending' ORDER BY submitted_at ASC`,
  ).all() as any[]

  let movedCount = 0
  for (const movement of movements) {
    let fromPos = movement.from_position as number
    if (movement.level_gd_id) {
      const row = db.prepare(`SELECT position FROM levels WHERE gd_id = ?`).get(movement.level_gd_id) as { position: number } | undefined
      if (row) fromPos = row.position
    }
    const levelRow = db.prepare(`SELECT id FROM levels WHERE position = ?`).get(fromPos) as { id: number } | undefined
    if (!levelRow) {
      db.prepare(`UPDATE pending_movements SET status = 'rejected', decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
        .run(account.id, movement.id)
      continue
    }

    const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
    const toPos = Math.min(movement.to_position as number, maxPos)
    if (fromPos === toPos) {
      db.prepare(`UPDATE pending_movements SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
        .run(account.id, movement.id)
      continue
    }

    db.exec('BEGIN')
    try {
      db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(STASH, fromPos)
      if (toPos < fromPos) {
        db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ? AND position < ?`).run(toPos, fromPos)
      } else {
        db.prepare(`UPDATE levels SET position = -(position - 1) WHERE position > ? AND position <= ?`).run(fromPos, toPos)
      }
      db.prepare(`UPDATE levels SET position = -position WHERE position < 0 AND position != ?`).run(STASH)
      db.prepare(`UPDATE levels SET position = ? WHERE position = ?`).run(toPos, STASH)

      const existingToday = db.prepare(
        `SELECT id FROM position_history
         WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now')
         ORDER BY changed_at ASC, id ASC LIMIT 1`,
      ).get(levelRow.id) as { id: number } | undefined
      if (existingToday) {
        db.prepare(`UPDATE position_history SET to_position = ?, changed_at = datetime('now'), changed_by = ? WHERE id = ?`)
          .run(toPos, account.id, existingToday.id)
        db.prepare(`DELETE FROM position_history WHERE level_id = ? AND from_position IS NOT NULL AND DATE(changed_at) = DATE('now') AND id != ?`)
          .run(levelRow.id, existingToday.id)
      } else {
        db.prepare(`INSERT INTO position_history (level_id, from_position, to_position, changed_by) VALUES (?, ?, ?, ?)`)
          .run(levelRow.id, fromPos, toPos, account.id)
      }

      db.prepare(`UPDATE pending_movements SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
        .run(account.id, movement.id)
      db.exec('COMMIT')
      movedCount++
    } catch {
      db.exec('ROLLBACK')
    }
  }

  if (placedCount > 0 || movedCount > 0) recomputePoints(db)

  return { ok: true, placed: placedCount, moved: movedCount }
})

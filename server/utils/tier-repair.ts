import type { DatabaseSync } from 'node:sqlite'

/**
 * Correct tiers that are out of step with both of their neighbours.
 *
 * The list is ordered by difficulty, so a level's tier should sit between the
 * tiers above and below it. When the levels either side agree with each other
 * but disagree with the level between them — Tier 31, Tier 30, Tier 31 — the
 * odd one out is a data-entry slip in the sheet, not a real difficulty jump.
 * Those get rewritten to the neighbours' tier.
 *
 * Deliberately conservative:
 *  - both neighbours must exist and carry the *same* tier
 *  - the two neighbours must be adjacent to this level by position, so a gap
 *    left by a deleted row never bridges unrelated levels
 *  - only the sandwiched level changes; runs of two or more disagreeing levels
 *    are left alone, because that's a genuine difficulty band rather than a typo
 */
export type TierFix = {
  id: number
  position: number
  name: string
  from: string | null
  to: string
}

export function findSandwichedTiers(db: DatabaseSync): TierFix[] {
  const rows = db.prepare(
    `SELECT id, position, name, gddl_tier FROM levels ORDER BY position ASC`,
  ).all() as { id: number; position: number; name: string; gddl_tier: string | null }[]

  const fixes: TierFix[] = []
  for (let i = 1; i < rows.length - 1; i++) {
    const prev = rows[i - 1]!
    const cur = rows[i]!
    const next = rows[i + 1]!

    if (prev.position !== cur.position - 1 || next.position !== cur.position + 1) continue
    if (!prev.gddl_tier || !next.gddl_tier) continue
    if (prev.gddl_tier !== next.gddl_tier) continue
    if (cur.gddl_tier === prev.gddl_tier) continue

    fixes.push({
      id: cur.id,
      position: cur.position,
      name: cur.name,
      from: cur.gddl_tier,
      to: prev.gddl_tier,
    })
  }
  return fixes
}

/** Apply `findSandwichedTiers`. Returns the fixes made. */
export function repairSandwichedTiers(db: DatabaseSync): TierFix[] {
  const fixes = findSandwichedTiers(db)
  if (fixes.length === 0) return fixes

  const upd = db.prepare(`UPDATE levels SET gddl_tier = ? WHERE id = ?`)
  db.exec('BEGIN')
  try {
    for (const f of fixes) upd.run(f.to, f.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return fixes
}

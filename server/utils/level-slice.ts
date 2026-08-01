/**
 * The level-selection filter behind "create a custom list from the ALL list".
 *
 * Shared by the create endpoint and its preview so the count an admin sees
 * before pressing the button is, by construction, the same set the button
 * creates — the two can't drift apart.
 */
export type LevelSliceFilter = {
  from_position?: number | null
  to_position?: number | null
  tier?: string | null
  rated?: string | null
}

export function buildLevelSliceWhere(f: LevelSliceFilter): { where: string; params: any[] } {
  const conds: string[] = []
  const params: any[] = []

  const from = Number(f?.from_position)
  const to = Number(f?.to_position)
  if (Number.isInteger(from) && from > 0) { conds.push('position >= ?'); params.push(from) }
  if (Number.isInteger(to) && to > 0) { conds.push('position <= ?'); params.push(to) }
  if (f?.tier) { conds.push('gddl_tier = ?'); params.push(String(f.tier)) }
  if (f?.rated) { conds.push('rated = ?'); params.push(String(f.rated)) }

  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params }
}

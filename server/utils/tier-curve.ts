import type { DatabaseSync } from 'node:sqlite'
// Relative, not `~`: the importers pull this in and also run standalone under
// `node --experimental-strip-types`, where Nuxt's alias doesn't exist.
import { tierToOrd, type TierCurve } from '../../utils/tier-ordinal.ts'

/**
 * Where each tier actually sits on the list.
 *
 * This is the shape every placement→tier estimate is measured against, and it
 * is measured rather than assumed for two reasons. It is not a line — the top
 * five tiers fit inside 300 placements and the bottom fifteen span ten thousand
 * — so no closed form was ever going to fit it. And it moves: the list grows,
 * levels are re-tiered, and a constant baked in today is wrong by next year.
 *
 * One point per tier, at that tier's median placement, which is the same
 * statistic `/api/levels/tier-midpoint` reports for a single tier. The median
 * rather than the mean because a handful of hand-placed outliers shouldn't drag
 * a tier's anchor hundreds of places.
 *
 * Tiers with too few levels are dropped: a tier with two levels in it says
 * more about those two than about the tier, and an anchor built from it bends
 * the curve around them.
 */
const MIN_LEVELS_PER_TIER = 5

export function buildTierCurve(db: DatabaseSync): TierCurve {
  const tiers = db.prepare(
    `SELECT gddl_tier AS tier, COUNT(*) AS n
       FROM levels
      WHERE gddl_tier IS NOT NULL AND gddl_tier != ''
      GROUP BY gddl_tier
      HAVING COUNT(*) >= ?`,
  ).all(MIN_LEVELS_PER_TIER) as { tier: string; n: number }[]

  const median = db.prepare(
    `SELECT position FROM levels
      WHERE gddl_tier = ? ORDER BY position ASC LIMIT 1 OFFSET ?`,
  )

  const points: TierCurve = []
  for (const t of tiers) {
    const ord = tierToOrd(t.tier)
    if (ord == null) continue
    const row = median.get(t.tier, Math.floor(t.n / 2)) as { position: number } | undefined
    if (!row || !(row.position > 0)) continue
    points.push({ ord, placement: row.position })
  }

  points.sort((a, b) => a.placement - b.placement)

  /**
   * Force the curve to descend as placements grow.
   *
   * Ordering by placement can leave a tier out of step — a tier whose levels
   * are mostly high but whose median lands below a harder tier's. Interpolating
   * across that produces a tier estimate that goes *up* further down the list,
   * which is never right. Keeping only the points that keep descending is
   * enough: what's dropped is the disagreement, not the shape.
   */
  const monotonic: TierCurve = []
  for (const p of points) {
    if (monotonic.length && p.ord >= monotonic[monotonic.length - 1]!.ord) continue
    monotonic.push(p)
  }
  return monotonic
}

/**
 * Cached: the query is four figures of rows and the answer moves on the scale
 * of imports, not requests. Dropped whenever placements or tiers change.
 */
const TTL_MS = 10 * 60_000
let cache: { at: number; curve: TierCurve } | null = null

export function getTierCurve(db: DatabaseSync): TierCurve {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.curve
  const curve = buildTierCurve(db)
  cache = { at: Date.now(), curve }
  return curve
}

export function invalidateTierCurve(): void {
  cache = null
}

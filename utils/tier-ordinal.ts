/**
 * Tiers as numbers, so they can be compared and interpolated.
 *
 * The scale runs Subtier 0…5 then Tier 1…39, which is one continuous ordering
 * even though it's written as two words. Mapping it to 0…44 lets "halfway
 * between Subtier 4 and Tier 2" be an ordinary average.
 */

/** `Subtier 3` → 3, `Tier 1` → 6, `Tier 39` → 44. Null for anything else. */
export function tierToOrd(tier: string | null | undefined): number | null {
  if (!tier) return null
  const s = tier.trim().match(/^Subtier (\d{1,2})$/i)
  if (s) return Number(s[1])
  const t = tier.trim().match(/^Tier (\d{1,2})$/i)
  if (t) return 5 + Number(t[1])
  return null
}

/** The inverse. Clamped to the real range so a wild average can't escape it. */
export function ordToTier(ord: number): string {
  const n = Math.max(0, Math.min(44, Math.round(ord)))
  return n <= 5 ? `Subtier ${n}` : `Tier ${n - 5}`
}

/**
 * Estimate where a level belongs from the levels around it.
 *
 * `above` is the nearest neighbour that's harder (higher on the list), `below`
 * the nearest that's easier. Both carry an ALL placement and, ideally, a tier.
 * With two neighbours the estimate is their midpoint; with one it sits directly
 * beside it; with none there's nothing to say and it returns nulls.
 *
 * Placement is deliberately biased toward the *easier* side when interpolating
 * between two neighbours — a new level is far more often placed just below the
 * harder one than exactly halfway, and a too-low guess is easier for a curator
 * to spot than a too-high one.
 */
export type TierNeighbour = {
  /** Placement on the ALL list. */
  placement: number | null
  gddl_tier?: string | null
} | null

export type PlacementEstimate = {
  placement: number | null
  tier: string | null
  /** Plain-language account of what the estimate was derived from. */
  basis: string | null
}

export function estimateFromNeighbours(
  above: TierNeighbour,
  below: TierNeighbour,
): PlacementEstimate {
  const aPlace = above?.placement ?? null
  const bPlace = below?.placement ?? null
  const aTier = tierToOrd(above?.gddl_tier)
  const bTier = tierToOrd(below?.gddl_tier)

  let placement: number | null = null
  let tier: string | null = null
  let basis: string | null = null

  if (aPlace != null && bPlace != null) {
    // Neighbours can be the "wrong" way round if the custom list disagrees with
    // the ALL's ordering; sort so the maths holds either way.
    const lo = Math.min(aPlace, bPlace)
    const hi = Math.max(aPlace, bPlace)
    placement = hi - lo <= 1 ? hi : Math.round((lo + hi) / 2)
    basis = `between #${lo} and #${hi} on the ALL`
  } else if (aPlace != null) {
    placement = aPlace + 1
    basis = `just below #${aPlace} on the ALL`
  } else if (bPlace != null) {
    placement = Math.max(1, bPlace)
    basis = `just above #${bPlace} on the ALL`
  }

  if (aTier != null && bTier != null) {
    tier = ordToTier((aTier + bTier) / 2)
  } else if (aTier != null) {
    tier = ordToTier(aTier)
  } else if (bTier != null) {
    tier = ordToTier(bTier)
  }

  return { placement, tier, basis }
}

/**
 * Pick the nearest neighbours of `index` in a custom list that are actually on
 * the ALL list, walking outwards in both directions.
 *
 * A custom list is usually a mix of levels the ALL already has and levels it
 * doesn't; only the former can anchor an estimate.
 */
export function findAllNeighbours<T extends { position?: number | null; sheet_placement?: number | null; gddl_tier?: string | null }>(
  items: T[],
  index: number,
): { above: TierNeighbour; below: TierNeighbour } {
  const anchored = (i: T): TierNeighbour => {
    const placement = i.sheet_placement ?? i.position ?? null
    return placement == null ? null : { placement, gddl_tier: i.gddl_tier ?? null }
  }

  let above: TierNeighbour = null
  for (let i = index - 1; i >= 0; i--) {
    const hit = anchored(items[i]!)
    if (hit) { above = hit; break }
  }

  let below: TierNeighbour = null
  for (let i = index + 1; i < items.length; i++) {
    const hit = anchored(items[i]!)
    if (hit) { below = hit; break }
  }

  return { above, below }
}

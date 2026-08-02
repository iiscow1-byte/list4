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
 * Estimating where a level belongs from the levels around it.
 *
 * The input is an ordered list — a custom list, or another site's list — where
 * some rows are already on the ALL and most aren't. Every row that *is* on the
 * ALL is an anchor: it ties a slot in this list to a real placement. Estimating
 * an unanchored row means reading the anchors around it.
 *
 * Two things the previous version got wrong, both of which produced the same
 * visible symptom — a run of rows all reporting the identical guess:
 *
 *   1. It used only the nearest anchor on each side and ignored how far away
 *      they were, so five rows between #100 and #200 all came back "#150".
 *   2. Past the last anchor it had nothing to extrapolate from and simply
 *      repeated that anchor's tier, so everything below the lowest-ranked level
 *      on the list was stuck at one tier no matter how many rows followed.
 *
 * Both are fixed by treating the anchors as a curve rather than as a pair of
 * bounds: interpolate by row distance between them, and continue the local
 * slope past the ends.
 */
export type PlacementEstimate = {
  placement: number | null
  tier: string | null
  /** Plain-language account of what the estimate was derived from. */
  basis: string | null
}

/** One row of the source list that is already on the ALL. */
export type EstimateAnchor = {
  /** Index of that row within the source list (any monotonic row number). */
  index: number
  /** Its placement on the ALL. */
  placement: number
  /** Its tier as an ordinal, when it has one. */
  tierOrd: number | null
}

/**
 * Rows past the last anchor are extrapolated, and an extrapolation that runs
 * for hundreds of rows stops being information. One tier per row is already an
 * aggressive gradient — beyond that the number says more about the arithmetic
 * than about the level.
 */
const MAX_TIER_SLOPE = 1

/** Nearest anchors on each side of `index`, plus the ones behind them. */
function bracket(anchors: EstimateAnchor[], index: number) {
  // Anchors are sorted by index; find the first one at or past `index`.
  let lo = 0, hi = anchors.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (anchors[mid]!.index < index) lo = mid + 1
    else hi = mid
  }
  // An anchor sitting exactly on `index` is the row itself — it belongs to the
  // "below" side so the row is never estimated from its own placement.
  return {
    above: anchors[lo - 1] ?? null,
    above2: anchors[lo - 2] ?? null,
    below: anchors[lo] ?? null,
    below2: anchors[lo + 1] ?? null,
  }
}

/** Slope per row between two anchors, or null when it can't be read. */
function slopeBetween(
  near: EstimateAnchor | null,
  far: EstimateAnchor | null,
  pick: (a: EstimateAnchor) => number | null,
): number | null {
  if (!near || !far) return null
  const a = pick(near), b = pick(far)
  if (a == null || b == null) return null
  const rows = near.index - far.index
  if (rows === 0) return null
  return (a - b) / rows
}

/**
 * Where the row at `index` would sit, given the anchors around it.
 *
 * `anchors` must be sorted ascending by `index`. Rows that carry no tier can
 * still anchor a placement, so the two estimates are bracketed independently —
 * a run of tierless anchors doesn't stop the tier estimate from reaching past
 * them to the last one that had a tier.
 */
export function estimateAt(anchors: EstimateAnchor[], index: number): PlacementEstimate {
  if (!anchors.length) return { placement: null, tier: null, basis: null }

  const p = estimatePlacement(anchors, index)
  const tiered = anchors.filter((a) => a.tierOrd != null)
  const t = estimateTier(tiered, index)

  return { placement: p.value, tier: t.value == null ? null : ordToTier(t.value), basis: p.basis ?? t.basis }
}

function estimatePlacement(anchors: EstimateAnchor[], index: number): { value: number | null; basis: string | null } {
  const { above, above2, below, below2 } = bracket(anchors, index)

  if (above && below) {
    // Interpolate by row distance, so consecutive rows in one gap land on
    // different placements instead of all collapsing onto the midpoint.
    const span = below.index - above.index
    const frac = span > 0 ? (index - above.index) / span : 0.5
    const raw = above.placement + frac * (below.placement - above.placement)
    // The two can be the "wrong" way round when the source list disagrees with
    // the ALL's ordering; the interpolation still holds, the bounds just swap.
    const lo = Math.min(above.placement, below.placement)
    const hi = Math.max(above.placement, below.placement)
    // Kept strictly inside the bracket where there's room: a level estimated to
    // sit *between* two others shouldn't come back with one of their numbers.
    const floor = Math.min(lo + 1, hi)
    const value = Math.max(1, Math.min(Math.max(floor, Math.round(raw)), hi))
    return { value, basis: `between #${lo} and #${hi} on the ALL` }
  }

  // Past an end of the anchor set, the estimate is an extrapolation, and the
  // wording has to say so: "just below #4043" is a lie when this list's own
  // spacing puts the next row 1,300 places further down.
  const rowsWord = (n: number) => (n === 1 ? '1 row' : `${n} rows`)
  const spaced = (slope: number | null) => slope != null && slope > 1.5

  if (above) {
    // Keep going at the rate the last two anchors set. Without a second anchor,
    // one placement per row is the only honest guess.
    const slope = slopeBetween(above, above2, (a) => a.placement)
    const step = slope != null && slope > 0 ? slope : 1
    const rows = index - above.index
    const value = Math.max(1, Math.round(above.placement + step * rows))
    return {
      value,
      basis: spaced(slope)
        ? `${rowsWord(rows)} below #${above.placement}, continuing this list's spacing`
        : `${rows === 1 ? 'just' : rowsWord(rows)} below #${above.placement} on the ALL`,
    }
  }

  if (below) {
    // Above the first anchor — same idea, walking upwards.
    const slope = slopeBetween(below2, below, (a) => a.placement)
    const step = slope != null && slope > 0 ? slope : 1
    const rows = below.index - index
    const value = Math.max(1, Math.round(below.placement - step * rows))
    return {
      value,
      basis: spaced(slope)
        ? `${rowsWord(rows)} above #${below.placement}, continuing this list's spacing`
        : `${rows === 1 ? 'just' : rowsWord(rows)} above #${below.placement} on the ALL`,
    }
  }

  return { value: null, basis: null }
}

function estimateTier(tiered: EstimateAnchor[], index: number): { value: number | null; basis: string | null } {
  if (!tiered.length) return { value: null, basis: null }
  const { above, above2, below, below2 } = bracket(tiered, index)

  if (above && below) {
    const span = below.index - above.index
    const frac = span > 0 ? (index - above.index) / span : 0.5
    return { value: above.tierOrd! + frac * (below.tierOrd! - above.tierOrd!), basis: null }
  }

  if (above) {
    // The bug this exists to fix: with one anchor and no slope the answer was
    // always that anchor's own tier, so every row below the lowest-ranked level
    // on the list reported the same tier however far down it was.
    const slope = slopeBetween(above, above2, (a) => a.tierOrd)
    if (slope == null) return { value: above.tierOrd!, basis: null }
    const step = Math.max(-MAX_TIER_SLOPE, Math.min(MAX_TIER_SLOPE, slope))
    return { value: above.tierOrd! + step * (index - above.index), basis: null }
  }

  if (below) {
    const slope = slopeBetween(below2, below, (a) => a.tierOrd)
    if (slope == null) return { value: below.tierOrd!, basis: null }
    const step = Math.max(-MAX_TIER_SLOPE, Math.min(MAX_TIER_SLOPE, slope))
    return { value: below.tierOrd! - step * (below.index - index), basis: null }
  }

  return { value: null, basis: null }
}

/**
 * Anchors from a custom list's items, in list order.
 *
 * A row is an anchor when it resolves to a level on the ALL — `sheet_placement`
 * is the number the site prints, `position` the internal one; either identifies
 * a real slot, so prefer the former and fall back to the latter.
 */
export function anchorsFromItems<
  T extends { position?: number | null; sheet_placement?: number | null; gddl_tier?: string | null },
>(items: T[]): EstimateAnchor[] {
  const out: EstimateAnchor[] = []
  items.forEach((item, index) => {
    const placement = item.sheet_placement ?? item.position ?? null
    if (placement == null) return
    out.push({ index, placement, tierOrd: tierToOrd(item.gddl_tier) })
  })
  return out
}

/**
 * Estimate for one row of a custom list, by index. Convenience wrapper for the
 * common case where the anchors come from the same array.
 */
export function estimateForItem<
  T extends { position?: number | null; sheet_placement?: number | null; gddl_tier?: string | null },
>(items: T[], index: number): PlacementEstimate {
  return estimateAt(anchorsFromItems(items), index)
}

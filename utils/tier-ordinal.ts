/**
 * Tiers as numbers, so they can be compared and interpolated.
 *
 * The scale runs Subtier 0…5 then Tier 1…45, which is one continuous ordering
 * even though it's written as two words. Mapping it to 0…50 lets "halfway
 * between Subtier 4 and Tier 2" be an ordinary average.
 *
 * The top used to be Tier 39, which is where the source sheet's own palette
 * stops. The list has since needed room above it, so the ceiling is a named
 * constant — everything that draws a tier slider, clamps an estimate or offers
 * a tier dropdown reads it from here rather than repeating the number.
 */

/** The highest tier the site will name. */
export const TIER_MAX_NUMBER = 45
/** …as an ordinal, which is what sliders and estimates work in. */
export const TIER_MAX_ORD = 5 + TIER_MAX_NUMBER

/**
 * `Subtier 3` → 3, `Tier 1` → 6, `Tier 45` → 50. Null for anything else.
 *
 * Out-of-range labels are null rather than clamped, because a label off the end
 * of the scale is not a tier that happens to be extreme — it is something we
 * can't read. `Subtier 6` in particular has to be rejected: 6 is Tier 1's
 * ordinal, so a lenient parse would silently call it that.
 */
export function tierToOrd(tier: string | null | undefined): number | null {
  if (!tier) return null
  const s = tier.trim().match(/^Subtier (\d{1,2})$/i)
  if (s) {
    const n = Number(s[1])
    return n <= 5 ? n : null
  }
  const t = tier.trim().match(/^Tier (\d{1,2})$/i)
  if (t) {
    const n = Number(t[1])
    return n >= 1 && n <= TIER_MAX_NUMBER ? 5 + n : null
  }
  return null
}

/** The inverse. Clamped to the real range so a wild average can't escape it. */
export function ordToTier(ord: number): string {
  const n = Math.max(0, Math.min(TIER_MAX_ORD, Math.round(ord)))
  return n <= 5 ? `Subtier ${n}` : `Tier ${n - 5}`
}

/**
 * Is this exactly a tier the site has, spelled the way the site spells it?
 *
 * Stricter than `tierToOrd` on purpose. That one *parses* — it reads whatever a
 * mirror or a spreadsheet cell offers. This one guards writes, and `tier 3 `
 * going into the database would be a value that no `gddl_tier = 'Tier 3'`
 * filter, sort or group-by ever matches again.
 */
export function isValidTier(tier: string | null | undefined): boolean {
  if (typeof tier !== 'string') return false
  const s = tier.match(/^Subtier ([0-5])$/)
  if (s) return true
  const t = tier.match(/^Tier ([1-9]\d?)$/)
  return !!t && Number(t[1]) <= TIER_MAX_NUMBER
}

/** Every tier the site knows, hardest first — for dropdowns and pickers. */
export const ALL_TIERS: string[] = [
  ...Array.from({ length: TIER_MAX_NUMBER }, (_, i) => `Tier ${TIER_MAX_NUMBER - i}`),
  'Subtier 5', 'Subtier 4', 'Subtier 3', 'Subtier 2', 'Subtier 1', 'Subtier 0',
]

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
export function estimateAt(
  anchors: EstimateAnchor[],
  index: number,
  curve?: TierCurve | null,
): PlacementEstimate {
  if (!anchors.length) return { placement: null, tier: null, basis: null }

  const p = estimatePlacement(anchors, index)
  const tiered = anchors.filter((a) => a.tierOrd != null)
  // The placement is worked out first and then handed to the tier estimate,
  // because where a level lands is what decides its tier — see `estimateTier`.
  const t = estimateTier(tiered, index, p.value, curve)

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

/**
 * Where each tier sits on the ALL — the shape the estimate is measured against.
 *
 * Tier is a function of *where a level lands*, not of how many rows down a list
 * it happens to be written, and that function is nowhere near a straight line.
 * Measured off the real list, the top five tiers are spent inside the first 300
 * placements while the bottom fifteen share everything from #7,000 to #17,000:
 *
 *     Tier 40  →  #2        Tier 25  →  #3,234
 *     Tier 35  →  #281      Tier 20  →  #7,011
 *     Tier 30  →  #1,690    Tier 10  →  #10,025
 *                           Tier 1   →  #17,620
 *
 * Spacing rows evenly across a gap that wide is what made tiers "scale down
 * extremely slowly": a list anchored at #50 (Tier 37) and #30,000 (Tier 1) gave
 * the row halfway between them Tier 18, when the placement halfway between them
 * is #15,000 — a Tier 1 level. Every row in the gap was wrong, and the wider
 * the gap the more wrong it got. A log scale is closer but still misses badly,
 * because the curve is steep at the top and nearly flat at the bottom.
 *
 * So the curve is measured rather than assumed: `server/utils/tier-curve.ts`
 * reads each tier's median placement out of the database, and it is passed in
 * here. Sorted by placement ascending. Absent, everything below falls back to
 * the anchors' own spacing.
 */
export type TierCurvePoint = { ord: number; placement: number }
export type TierCurve = TierCurvePoint[]

/**
 * The tier the list itself has around `placement`, as a fractional ordinal.
 *
 * Interpolated in log-placement space *between* measured points, which is a
 * good local approximation even though it is a poor global one — consecutive
 * tiers are close enough together for the curvature between them not to matter.
 */
export function tierAtPlacement(curve: TierCurve | null | undefined, placement: number): number | null {
  if (!curve?.length || !(placement > 0)) return null
  if (curve.length === 1) return curve[0]!.ord

  let lo = 0, hi = curve.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (curve[mid]!.placement < placement) lo = mid + 1
    else hi = mid
  }
  const a = curve[lo - 1] ?? curve[0]!
  const b = curve[lo] ?? curve[curve.length - 1]!
  if (a === b) return a.ord

  const la = Math.log(a.placement), lb = Math.log(b.placement)
  if (la === lb) return a.ord
  // Not clamped: past either end the nearest pair's slope carries on, which is
  // what makes a level below the last measured tier keep descending.
  const frac = (Math.log(placement) - la) / (lb - la)
  return clampOrd(a.ord + frac * (b.ord - a.ord))
}

function estimateTier(
  tiered: EstimateAnchor[],
  index: number,
  placement: number | null,
  curve: TierCurve | null | undefined,
): { value: number | null; basis: string | null } {
  if (!tiered.length) return { value: null, basis: null }
  const { above, above2, below, below2 } = bracket(tiered, index)

  /**
   * How far the curve says the tier moves between two placements.
   *
   * Used as the *shape* of the interpolation while the anchors stay the
   * endpoints, so a list that sits systematically harder or easier than the ALL
   * keeps its offset instead of being flattened onto the ALL's own numbers.
   */
  const curveOrd = (p: number | null | undefined) =>
    p == null ? null : tierAtPlacement(curve, p)

  if (above && below) {
    const cA = curveOrd(above.placement)
    const cB = curveOrd(below.placement)
    const cP = curveOrd(placement)
    if (cA != null && cB != null && cP != null && cA !== cB) {
      // Clamped, so a placement estimate that strays outside the pair can't
      // push the tier past the anchors that are supposed to bound it.
      const frac = Math.max(0, Math.min(1, (cP - cA) / (cB - cA)))
      return { value: above.tierOrd! + frac * (below.tierOrd! - above.tierOrd!), basis: null }
    }
    const span = below.index - above.index
    const frac = span > 0 ? (index - above.index) / span : 0.5
    return { value: above.tierOrd! + frac * (below.tierOrd! - above.tierOrd!), basis: null }
  }

  if (above) {
    // Past the last anchor: carry the curve's own change from that anchor to
    // wherever this row lands, keeping the anchor's offset from the curve.
    const cA = curveOrd(above.placement)
    const cP = curveOrd(placement)
    if (cA != null && cP != null) {
      return { value: clampOrd(above.tierOrd! + (cP - cA)), basis: null }
    }
    // The bug this exists to fix: with one anchor and no slope the answer was
    // always that anchor's own tier, so every row below the lowest-ranked level
    // on the list reported the same tier however far down it was.
    const slope = slopeBetween(above, above2, (a) => a.tierOrd)
    if (slope == null) return { value: above.tierOrd!, basis: null }
    const step = Math.max(-MAX_TIER_SLOPE, Math.min(MAX_TIER_SLOPE, slope))
    return { value: above.tierOrd! + step * (index - above.index), basis: null }
  }

  if (below) {
    const cB = curveOrd(below.placement)
    const cP = curveOrd(placement)
    if (cB != null && cP != null) {
      return { value: clampOrd(below.tierOrd! + (cP - cB)), basis: null }
    }
    const slope = slopeBetween(below2, below, (a) => a.tierOrd)
    if (slope == null) return { value: below.tierOrd!, basis: null }
    const step = Math.max(-MAX_TIER_SLOPE, Math.min(MAX_TIER_SLOPE, slope))
    return { value: below.tierOrd! - step * (below.index - index), basis: null }
  }

  return { value: null, basis: null }
}

const clampOrd = (n: number) => Math.max(0, Math.min(TIER_MAX_ORD, n))

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
>(items: T[], index: number, curve?: TierCurve | null): PlacementEstimate {
  return estimateAt(anchorsFromItems(items), index, curve)
}

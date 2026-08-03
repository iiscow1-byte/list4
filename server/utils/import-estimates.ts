/**
 * Placement / tier estimates for levels arriving from another list.
 *
 * Every importer had its own copy of this arithmetic and every copy had the
 * same two flaws: it looked only at the single nearest match on each side, and
 * past the end of the overlap it gave up and repeated that match's tier. A list
 * whose bottom half the ALL doesn't carry therefore imported with every one of
 * those levels claiming the same tier and near-identical placements.
 *
 * The maths now lives in `utils/tier-ordinal`, shared with the custom-list
 * estimator so a level guessed at by an importer and the same level guessed at
 * in the browser can't disagree. Imported with a relative path on purpose: the
 * importers also run standalone under `node --experimental-strip-types`, where
 * Nuxt's `~` alias doesn't exist.
 */
import { estimateAt, tierToOrd, type EstimateAnchor, type PlacementEstimate, type TierCurve } from '../../utils/tier-ordinal.ts'

export type { PlacementEstimate }

/** A level the source list and the ALL list share — one row of the overlap. */
export type SharedRow = {
  /** Rank on the source list. */
  sourcePos: number
  /** Its placement on the ALL. */
  allPos: number
  /** Its ALL tier, when it has one. */
  tier?: string | null
}

/**
 * Anchors for `estimateAt`, keyed by source-list rank.
 *
 * Rank is the index here rather than an array offset, so a level at source
 * position 300 sitting between anchors at 250 and 400 is placed three-fifths of
 * the way along that stretch rather than merely "somewhere between them".
 */
export function buildAnchors(rows: SharedRow[]): EstimateAnchor[] {
  return rows
    .map((r) => ({ index: r.sourcePos, placement: r.allPos, tierOrd: tierToOrd(r.tier ?? null) }))
    .sort((a, b) => a.index - b.index)
}

/**
 * Where a source-list level at `sourcePos` would land on the ALL.
 *
 * `curve` is the ALL's measured tier→placement shape. Optional because the
 * importers run standalone as well as inside Nitro, and an estimate without it
 * is the older row-spaced answer rather than no answer at all.
 */
export function estimateForSourcePosition(
  anchors: EstimateAnchor[],
  sourcePos: number,
  curve?: TierCurve | null,
): PlacementEstimate {
  return estimateAt(anchors, sourcePos, curve)
}

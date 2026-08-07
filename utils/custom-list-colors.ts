import { tierColor } from './tier-colors'
import { anchorsFromItems, estimateAt, ordToTier, tierToOrd, type TierCurve } from './tier-ordinal'

/**
 * What colour a custom list's rank badges are.
 *
 * The main list colours a row by its tier, which is why reading down it looks
 * like a gradient: the list is ordered by difficulty and the palette follows.
 * A custom list gets that for free for the levels the ALL carries, and nothing
 * at all for the rest — `tierColor(null)` is a neutral grey — so a list of
 * mostly-unranked levels came out as a column of grey boxes with occasional
 * colour, which reads as "these ones are broken" rather than "the ALL hasn't
 * ranked these".
 *
 * Two modes, chosen by the list's `mark_off_all` setting:
 *
 *   marked   — today's behaviour. Levels on the ALL take their tier's colour,
 *              everything else is grey. Honest about what the ALL has ranked,
 *              which is the point for a list read alongside the main one.
 *   scaled   — every row gets a colour. A row with a tier keeps it; a row
 *              without one is coloured by the tier it would have, read off the
 *              rows around it that do — the same interpolation the placement
 *              estimate already uses. A list with no tier information anywhere
 *              falls back to a ramp across its own length.
 *
 * "Scaled" never invents a tier *label*, only a colour. Nothing on the page
 * claims the level is Tier 27; it is drawn as though it sat where it sits.
 */

export type ColorItem = {
  gddl_tier?: string | null
  position?: number | null
  sheet_placement?: number | null
}

/**
 * Ends of the fallback ramp, used only when a list carries no tier at all.
 *
 * Tier 39 is where the sheet's own palette stops climbing, and Tier 1 is where
 * the demon tiers begin — between them is the full readable range, which is
 * what a standalone list wants its gradient to span. The tiers past 39 are
 * deliberately excluded: a list that says nothing about difficulty shouldn't
 * have its top row painted with the hardest colour the site owns.
 */
const RAMP_TOP_ORD = tierToOrd('Tier 39')!
const RAMP_BOTTOM_ORD = tierToOrd('Tier 1')!

/**
 * One colour per item, in the array's order.
 *
 * Returned as an array rather than a per-row function because the scaled mode
 * needs the whole list to answer any single row, and recomputing the anchor set
 * per row would make rendering a 250-row list quadratic.
 */
export function listRowColors(items: ColorItem[], markOffAll: boolean, curve?: TierCurve | null): string[] {
  if (markOffAll) return items.map((i) => tierColor(i.gddl_tier))
  return listRowTiers(items, curve).map((t) => tierColor(t))
}

/**
 * The tier each row is *drawn as*, under the scaled mode. Exported for the
 * places that want the label too — the estimate panel, mainly — so the two can
 * never disagree about what a row is being shown as.
 */
export function listRowTiers(items: ColorItem[], curve?: TierCurve | null): (string | null)[] {
  if (!items.length) return []

  const anchors = anchorsFromItems(items)
  const anyTier = anchors.some((a) => a.tierOrd != null)

  return items.map((item, index) => {
    if (item.gddl_tier) return item.gddl_tier
    if (anyTier) {
      const est = estimateAt(anchors, index, curve).tier
      if (est) return est
    }
    // Nothing anywhere on the list has a tier. Spread the readable range over
    // the list's own length so it still reads hardest-first.
    if (items.length === 1) return ordToTier(RAMP_TOP_ORD)
    const frac = index / (items.length - 1)
    return ordToTier(RAMP_TOP_ORD - frac * (RAMP_TOP_ORD - RAMP_BOTTOM_ORD))
  })
}

/** Guard for a badly-typed setting arriving from the API as 0/1/undefined. */
export function marksOffAll(list: { mark_off_all?: number | boolean | null } | null | undefined): boolean {
  // Absent means the older default, which is to mark.
  return list?.mark_off_all == null ? true : !!list.mark_off_all
}

/** `#rrggbb` → `"r g b"`, the triplet form Tailwind's colour variables take. */
export function hexToRgbTriplet(hex: string | null | undefined): string | null {
  const m = typeof hex === 'string' ? hex.trim().match(/^#([0-9a-f]{6})$/i) : null
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`
}

/**
 * A list's own colour, as a style binding for its root element.
 *
 * `accent_color` has been storable since 1.3. Tailwind resolves `accent`
 * through `--c-accent`, so setting that one variable on an element re-themes
 * every `text-accent` / `bg-accent` inside it — tabs, rank numbers, links — and
 * nothing outside it.
 *
 * Shared because it was applied on exactly one of a list's pages. A list with a
 * colour was itself on the level view and reverted to the site's amber the
 * moment you opened its leaderboard, which reads as the colour not having
 * saved. One definition, used by both roots.
 */
export function listAccentStyle(
  list: { accent_color?: string | null } | null | undefined,
): Record<string, string> | undefined {
  const rgb = hexToRgbTriplet(list?.accent_color)
  return rgb ? { '--c-accent': rgb } : undefined
}

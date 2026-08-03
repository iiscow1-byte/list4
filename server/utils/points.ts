import type { DatabaseSync } from 'node:sqlite'

/**
 * Midpoint point values per GDDL tier. A level placed exactly at its tier's
 * median list position gets the value below; everything else is linearly
 * interpolated between adjacent tier midpoints. Sourced from `dev/median levels`.
 */
export const TIER_POINTS: Record<string, number> = {
  'Subtier 0': 0,
  'Subtier 1': 0.05,
  'Subtier 2': 0.20,
  'Subtier 3': 0.30,
  'Subtier 4': 0.50,
  'Subtier 5': 0.75,
  'Tier 1': 1.25,
  'Tier 2': 2.5,
  'Tier 3': 3.5,
  'Tier 4': 4.5,
  'Tier 5': 5.5,
  'Tier 6': 6.7,
  'Tier 7': 8.2,
  'Tier 8': 10.4,
  'Tier 9': 13.5,
  'Tier 10': 17.3,
  'Tier 11': 22.5,
  'Tier 12': 27.3,
  'Tier 13': 32.3,
  'Tier 14': 37.6,
  'Tier 15': 45.1,
  'Tier 16': 55.2,
  'Tier 17': 67.5,
  'Tier 18': 80,
  'Tier 19': 92,
  'Tier 20': 115,
  'Tier 21': 140,
  'Tier 22': 180,
  'Tier 23': 225,
  'Tier 24': 290,
  'Tier 25': 360,
  'Tier 26': 445,
  'Tier 27': 560,
  'Tier 28': 722,
  'Tier 29': 890,
  'Tier 30': 1110,
  'Tier 31': 1540,
  'Tier 32': 2600,
  'Tier 33': 4070,
  'Tier 34': 5900,
  'Tier 35': 10000,
  'Tier 36': 20000,
  'Tier 37': 40000,
  'Tier 38': 75000,
  'Tier 39': 115000,
  'Tier 40': 175000,
  'Tier 41': 250000,
  // Tiers 42–46 continue the ~1.45× step the top of the table already runs at.
  // 46 is never assignable — the site's ceiling is Tier 45 — but the ramp needs
  // one tier above the highest in use to have something to extrapolate toward.
  'Tier 42': 360000,
  'Tier 43': 520000,
  'Tier 44': 750000,
  'Tier 45': 1080000,
  'Tier 46': 1560000,
}

type LevelRow = {
  id: number
  position: number
  gddl_tier: string | null
  same_as_above: number
  points: number | null
}

/**
 * All defined tiers ordered by ascending point value. Used to find which tier
 * sits "above" the highest currently-in-use tier when extending the anchor
 * ramp past the top of the list.
 */
const TIER_ORDER = Object.keys(TIER_POINTS).sort((a, b) => TIER_POINTS[a]! - TIER_POINTS[b]!)
const TIER_INDEX = new Map(TIER_ORDER.map((t, i) => [t, i]))

/**
 * Recompute and persist the `points` column for every main-list level.
 *
 * Algorithm: each tier with at least one level contributes an "anchor" at the
 * median position of its levels and the tier's midpoint points. Anchors are
 * sorted by position (low position = harder = higher points). For every level,
 * points are linearly interpolated between the two surrounding anchors.
 *
 * To avoid the topmost levels all clamping to a single value, we extend the
 * anchor list with a phantom anchor at position 0 carrying the *next* tier's
 * midpoint above the highest in-use tier — i.e. "as if there was a single
 * level in the next tier". Below the lowest anchor we still clamp.
 *
 * Levels with `same_as_above = 1` inherit the (already-computed) points of the
 * level immediately above them in position order; chains resolve in one pass
 * because we iterate by ascending position.
 *
 * Run inside a single transaction so partial failures don't leave half the
 * list with stale points.
 */
export function recomputePoints(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, position, gddl_tier, same_as_above, points
       FROM levels
       ORDER BY position ASC`,
    )
    .all() as LevelRow[]
  if (rows.length === 0) return

  const byTier = new Map<string, LevelRow[]>()
  for (const r of rows) {
    if (!r.gddl_tier || !(r.gddl_tier in TIER_POINTS)) continue
    let g = byTier.get(r.gddl_tier)
    if (!g) { g = []; byTier.set(r.gddl_tier, g) }
    g.push(r)
  }

  const anchors: { tier: string; pos: number; pts: number }[] = []
  for (const [tier, list] of byTier) {
    list.sort((a, b) => a.position - b.position)
    const mid = list[Math.floor(list.length / 2)]!.position
    anchors.push({ tier, pos: mid, pts: TIER_POINTS[tier]! })
  }
  anchors.sort((a, b) => a.pos - b.pos)

  // Phantom top anchor: pretend there's one level in the tier above the
  // highest currently-used tier, sitting at position 0 (above the entire
  // list). Levels in the topmost real tier now ramp toward that hypothetical
  // value instead of all clamping to the highest in-use midpoint.
  if (anchors.length > 0) {
    const topAnchor = anchors[0]!
    const topIdx = TIER_INDEX.get(topAnchor.tier)
    if (topIdx != null && topIdx + 1 < TIER_ORDER.length) {
      const nextTier = TIER_ORDER[topIdx + 1]!
      anchors.unshift({ tier: nextTier, pos: 0, pts: TIER_POINTS[nextTier]! })
    }
  }

  function interpolate(pos: number): number | null {
    if (anchors.length === 0) return null
    if (anchors.length === 1) return anchors[0]!.pts
    if (pos <= anchors[0]!.pos) return anchors[0]!.pts
    if (pos >= anchors[anchors.length - 1]!.pos) return anchors[anchors.length - 1]!.pts
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]!
      const b = anchors[i]!
      if (pos <= b.pos) {
        const t = (pos - a.pos) / (b.pos - a.pos)
        return a.pts + t * (b.pts - a.pts)
      }
    }
    return null
  }

  // First pass: tier-based interpolation for every level.
  const computed = new Map<number, number | null>()
  for (const r of rows) {
    computed.set(r.id, r.gddl_tier ? interpolate(r.position) : null)
  }

  // Second pass: levels marked "same as above" copy from the previous level.
  // rows is in ascending position order, so chains resolve naturally.
  let prev: LevelRow | null = null
  for (const r of rows) {
    if (r.same_as_above && prev) {
      computed.set(r.id, computed.get(prev.id) ?? null)
    }
    prev = r
  }

  // Round to 3 significant figures for cleaner display values across the full
  // range (0.0500, 17.3, 250000 all stay sensible). Number(toPrecision()) drops
  // the exponent string toPrecision yields for large values.
  function round(n: number | null): number | null {
    if (n == null) return null
    if (n === 0) return 0
    return Number(n.toPrecision(3))
  }

  const upd = db.prepare(`UPDATE levels SET points = ? WHERE id = ?`)
  db.exec('BEGIN')
  try {
    for (const r of rows) {
      const next = round(computed.get(r.id) ?? null)
      const cur = r.points
      if (next == null && cur == null) continue
      if (next != null && cur != null && Math.abs(next - cur) < 1e-6) continue
      upd.run(next, r.id)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

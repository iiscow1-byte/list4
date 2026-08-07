import type { DatabaseSync } from 'node:sqlite'
import { LIST_SOURCES, sourceLabel, sourceShortLabel } from '~/utils/list-source-catalog'

/** "CCL" out of "CCL — Consistency Challenge List", for the per-row wording. */
function sourceShortName(key: string): string {
  return sourceShortLabel(key)
}

/**
 * Where an imported list disagrees with the ALL about the order of levels both
 * of them carry.
 *
 * Importing a list already surfaces the levels the ALL is missing. What it
 * never surfaced is the other half of the comparison: the levels both lists
 * have, ranked differently. That is the part with an actual answer — "CCL puts
 * this level 400 places higher than we do" is a concrete claim, and acting on
 * it is one move.
 *
 * ## Which levels are "wrong"
 *
 * Naively, every pair the two lists order differently is a disagreement, which
 * on a list of 4,000 shared levels is tens of thousands of pairs describing a
 * few dozen actual problems. The useful question is the smallest set of levels
 * that would have to move for the two orderings to agree — and that set is
 * everything outside the longest increasing subsequence of ALL positions read
 * in source-list order. The LIS is the largest backbone the two lists already
 * agree on; everything else is a level that has to move to join it.
 *
 * ## Where each one would go
 *
 * The backbone doubles as the anchor set. Each disagreeing level sits between
 * two backbone levels on the source list, and the suggestion is the *smallest*
 * move that satisfies that: land it immediately on the far side of the anchor
 * it has to cross, and no further.
 *
 * This replaces an earlier version that interpolated a midpoint between the two
 * anchors' ALL positions. Midpoints were wrong for the case this tab exists to
 * serve — a level the imported list has *rearranged* since it was placed here.
 * If that list now puts it directly after some level, and the ALL happens to
 * carry forty levels between that one and the next shared level, the imported
 * list has no opinion about those forty; dropping the level in the middle of
 * them invents a claim it never made and moves the level twenty places further
 * than anything asked for. "Directly after the level it now follows" is the
 * whole of what the source said, and it is what a curator acting on the same
 * information would do.
 */

export type ImportedMovement = {
  level_id: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  /** Rank on the imported list. */
  source_position: number
  /** Where the level is now. */
  from_position: number
  from_placement: number | null
  /** Where the imported list's ordering says it belongs. */
  to_position: number
  to_placement: number | null
  /** Signed: negative means it should move up the list. */
  distance: number
  /** The agreeing levels the suggestion was read from. */
  basis: string | null
  /**
   * How firm the target is.
   *
   * `exact` — the imported list puts this level directly between two levels the
   * two lists already agree about, so its new neighbours are not a guess.
   * `bracketed` — other disagreeing levels share the same gap, so the order
   * within it is right but the exact slots depend on which is applied first.
   * `open` — only one side is anchored; the level is past an end of the
   * overlap and only "after X" or "before Y" is known.
   */
  confidence: 'exact' | 'bracketed' | 'open'
  dismissed: boolean
}

export type SourceSummary = {
  key: string
  label: string
  /** Levels this list and the ALL both carry. */
  shared: number
  /** Of those, how many disagree. */
  disagreements: number
  /** How many of the disagreements have been dismissed. */
  dismissed: number
}

type SharedRow = {
  source_position: number
  level_id: number
  position: number
  sheet_placement: number | null
  name: string
  gd_id: number | null
  gddl_tier: string | null
}

/**
 * Levels the ALL and `source` both carry, in the source list's order.
 *
 * A gd_id is not unique in `levels` — Solo/2P and Old/Unnerfed variants share
 * one — so a source row matching several ALL rows is skipped rather than
 * guessed at: suggesting a move for the wrong variant is worse than suggesting
 * nothing.
 */
/**
 * Drop any level whose GD id appears on the ALL more than once.
 *
 * Solo/2P and Old/Unnerfed variants legitimately share a GD id, so a source row
 * matching several ALL rows can't say which one it means — and suggesting a
 * move for the wrong variant is worse than suggesting nothing. Done here rather
 * than as a `COUNT(*) = 1` subquery in SQL: correlated against a derived table
 * that cost a full scan of all 54,000 levels per row, which turned this from
 * milliseconds into a minute.
 */
function dropAmbiguous(rows: SharedRow[]): SharedRow[] {
  const seen = new Map<number, number>()
  for (const r of rows) {
    if (r.gd_id == null) continue
    seen.set(r.gd_id, (seen.get(r.gd_id) ?? 0) + 1)
  }
  return rows.filter((r) => r.gd_id != null && seen.get(r.gd_id) === 1)
}

const SHARED_COLS = `l.id AS level_id, l.position, l.sheet_placement, l.name, l.gd_id, l.gddl_tier`

export function sharedWithAll(db: DatabaseSync, source: string): SharedRow[] {
  if (source === 'aredl') {
    return db.prepare(
      `SELECT id AS level_id, position, sheet_placement, name, gd_id, gddl_tier,
              aredl_position AS source_position
         FROM levels
        WHERE aredl_position IS NOT NULL
        ORDER BY aredl_position ASC`,
    ).all() as SharedRow[]
  }
  if (source === 'gdl') {
    return db.prepare(
      `SELECT id AS level_id, position, sheet_placement, name, gd_id, gddl_tier,
              gdl_position AS source_position
         FROM levels
        WHERE gdl_position IS NOT NULL
        ORDER BY gdl_position ASC`,
    ).all() as SharedRow[]
  }
  if (source === 'mscl') {
    return dropAmbiguous(db.prepare(
      `SELECT m.position AS source_position, ${SHARED_COLS}
         FROM mscl_levels m
         JOIN levels l ON l.gd_id = m.gd_id
        WHERE m.gd_id IS NOT NULL
        ORDER BY m.position ASC`,
    ).all() as SharedRow[])
  }
  if (source === 'acs') {
    // Only the ranked tab, and only its real placements: the importer parks
    // unranked rows past 100,000 so they can't collide with rank 1, and a
    // parked row has no opinion about ordering to disagree with.
    return dropAmbiguous(db.prepare(
      `SELECT a.position AS source_position, ${SHARED_COLS}
         FROM acs_levels a
         JOIN levels l ON l.gd_id = a.gd_id
        WHERE a.tab = 'extreme' AND a.position < 100000 AND a.gd_id IS NOT NULL
        ORDER BY a.position ASC`,
    ).all() as SharedRow[])
  }
  if (source.startsWith('gdtpl:')) {
    return dropAmbiguous(db.prepare(
      `SELECT g.position AS source_position, ${SHARED_COLS}
         FROM gdtpl_levels g
         JOIN levels l ON l.gd_id = g.gd_id
        WHERE g.list_slug = ? AND g.gd_id IS NOT NULL
        ORDER BY g.position ASC`,
    ).all(source.slice('gdtpl:'.length)) as SharedRow[])
  }
  return []
}

/**
 * Indices of the longest strictly-increasing subsequence of `values`.
 * Patience sorting with predecessor links — O(n log n), which matters because
 * the biggest imported list shares four thousand levels with the ALL.
 */
export function longestIncreasingRun(values: number[]): number[] {
  if (!values.length) return []
  // tails[k] = index of the smallest possible tail of an increasing run of
  // length k+1; prev[i] = the index before i in the run ending at i.
  const tails: number[] = []
  const prev: number[] = new Array(values.length).fill(-1)

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    let lo = 0, hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (values[tails[mid]!]! < v) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1
    tails[lo] = i
  }

  const out: number[] = []
  for (let i = tails[tails.length - 1]!; i !== -1; i = prev[i]!) out.push(i)
  return out.reverse()
}

type Dismissal = { level_id: number; source_position: number }

function loadDismissals(db: DatabaseSync, source: string): Map<number, number> {
  const rows = db.prepare(
    `SELECT level_id, source_position FROM imported_movement_dismissals WHERE source = ?`,
  ).all(source) as Dismissal[]
  return new Map(rows.map((r) => [r.level_id, r.source_position]))
}

/**
 * The smallest move that puts a level where the imported list says it goes.
 *
 * `above` / `below` are the nearest backbone levels on either side of it in the
 * *source* list — the ones the two lists already agree about. The level has to
 * end up between them, and any slot in that window satisfies the source; the
 * one chosen is the nearest to where the level already is, because everything
 * beyond that is movement the source never asked for.
 *
 * Returns null when the level already satisfies the constraint (it can be
 * outside the backbone for reasons that don't require it to move).
 */
function targetFor(
  current: number,
  above: SharedRow | undefined,
  below: SharedRow | undefined,
): number | null {
  // Too low: it must come before `below`, so the nearest legal slot is that
  // level's own — which pushes it down one and leaves the order right.
  if (below && current > below.position) return below.position
  // Too high: it must come after `above`; land on that level's slot, which the
  // shift leaves directly below it.
  if (above && current < above.position) return above.position
  return null
}

/** Everything `source` would move, in the order worth reading. */
export function computeImportedMovements(db: DatabaseSync, source: string): {
  items: ImportedMovement[]
  shared: number
} {
  const shared = sharedWithAll(db, source)
  if (shared.length < 2) return { items: [], shared: shared.length }

  const agreeing = longestIncreasingRun(shared.map((r) => r.position))
  const agreeingIdx = new Set(agreeing)
  const dismissals = loadDismissals(db, source)

  // For each row, the nearest backbone row on each side *in source order*.
  // Walked once rather than searched per row.
  const aboveOf: (number | undefined)[] = new Array(shared.length)
  const belowOf: (number | undefined)[] = new Array(shared.length)
  let lastBackbone: number | undefined
  for (let i = 0; i < shared.length; i++) {
    aboveOf[i] = lastBackbone
    if (agreeingIdx.has(i)) lastBackbone = i
  }
  lastBackbone = undefined
  for (let i = shared.length - 1; i >= 0; i--) {
    belowOf[i] = lastBackbone
    if (agreeingIdx.has(i)) lastBackbone = i
  }

  // How many disagreeing rows share each gap, so a level whose new neighbours
  // are unambiguous can be told apart from one competing for the same slot.
  const gapCount = new Map<string, number>()
  const gapKey = (i: number) => `${aboveOf[i] ?? 'start'}:${belowOf[i] ?? 'end'}`
  for (let i = 0; i < shared.length; i++) {
    if (agreeingIdx.has(i)) continue
    const k = gapKey(i)
    gapCount.set(k, (gapCount.get(k) ?? 0) + 1)
  }
  const gapSeen = new Map<string, number>()

  // Position → the placement number that slot prints. Read as one table scan
  // the first time a row needs it: per-row lookups cost milliseconds each,
  // which on a list sharing four thousand levels with the ALL is most of the
  // request, and a list that agrees with the ALL shouldn't pay for it at all.
  let placementByPosition: Map<number, number | null> | null = null
  const placementAt = (position: number): number | null => {
    if (!placementByPosition) {
      placementByPosition = new Map()
      for (const row of db.prepare(`SELECT position, sheet_placement FROM levels`).all() as
        { position: number; sheet_placement: number | null }[]) {
        placementByPosition.set(row.position, row.sheet_placement)
      }
    }
    return placementByPosition.get(position) ?? null
  }

  const items: ImportedMovement[] = []
  for (let i = 0; i < shared.length; i++) {
    if (agreeingIdx.has(i)) continue
    const r = shared[i]!
    const above = aboveOf[i] != null ? shared[aboveOf[i]!] : undefined
    const below = belowOf[i] != null ? shared[belowOf[i]!] : undefined

    let target = targetFor(r.position, above, below)
    if (target == null) continue

    // Several levels moved into the same gap land as a block, in source order.
    //
    // Applying is sequential and recomputes between each move, so the list ends
    // up right whatever numbers are shown here — but showing every one of them
    // the same target reads as a bug. A group moving up ends against the bottom
    // of the window, a group moving down against the top, which is where they
    // actually finish.
    const key = gapKey(i)
    const share = gapCount.get(key) ?? 1
    if (share > 1) {
      const nth = gapSeen.get(key) ?? 0
      gapSeen.set(key, nth + 1)
      const lo = above ? above.position : 1
      const hi = below ? below.position : Number.MAX_SAFE_INTEGER
      const movingUp = target < r.position
      target = movingUp
        ? Math.max(lo + 1, hi - (share - 1) + nth)
        : Math.min(hi - 1, lo + nth)
    }
    if (target === r.position) continue

    const confidence: ImportedMovement['confidence'] =
      !above || !below ? 'open' : share > 1 ? 'bracketed' : 'exact'

    const basis = above && below
      ? `${sourceShortName(source)} puts it between ${above.name} and ${below.name}`
      : above
        ? `${sourceShortName(source)} puts it after ${above.name}`
        : below
          ? `${sourceShortName(source)} puts it before ${below.name}`
          : null

    items.push({
      level_id: r.level_id,
      name: r.name,
      gd_id: r.gd_id,
      gddl_tier: r.gddl_tier,
      source_position: r.source_position,
      from_position: r.position,
      from_placement: r.sheet_placement,
      to_position: target,
      to_placement: placementAt(target),
      distance: target - r.position,
      basis,
      confidence,
      dismissed: dismissals.get(r.level_id) === r.source_position,
    })
  }

  // Rows whose new neighbours the source names outright come first — those are
  // the "this level was rearranged over there" cases, and they're the ones an
  // admin can act on without thinking. Everything else falls back to size.
  const rank = { exact: 0, bracketed: 1, open: 2 } as const
  items.sort((a, b) =>
    rank[a.confidence] - rank[b.confidence] || Math.abs(b.distance) - Math.abs(a.distance))
  return { items, shared: shared.length }
}

/**
 * A summary per source. Recomputed rather than stored, so it always describes
 * the lists as they are now; cached briefly because the admin badge polls it.
 */
let summaryCache: { at: number; value: SourceSummary[] } | null = null
// Comparing every imported list against the ALL is a few hundred milliseconds
// of synchronous work, and `node:sqlite` blocks the event loop while it runs.
// The admin badge polls twice a minute per open tab; this makes that one
// computation a minute for the whole process, whoever is looking.
const SUMMARY_TTL_MS = 60_000

export function importedMovementSummary(db: DatabaseSync, force = false): SourceSummary[] {
  if (!force && summaryCache && Date.now() - summaryCache.at < SUMMARY_TTL_MS) {
    return summaryCache.value
  }
  const value: SourceSummary[] = []
  for (const src of LIST_SOURCES) {
    if (src.key === 'all') continue
    const { items, shared } = computeImportedMovements(db, src.key)
    if (shared === 0) continue
    value.push({
      key: src.key,
      label: sourceLabel(src.key),
      shared,
      disagreements: items.filter((i) => !i.dismissed).length,
      dismissed: items.filter((i) => i.dismissed).length,
    })
  }
  value.sort((a, b) => b.disagreements - a.disagreements)
  summaryCache = { at: Date.now(), value }
  return value
}

/** Called after anything that changes the answer. */
export function invalidateImportedMovementSummary(): void {
  summaryCache = null
}

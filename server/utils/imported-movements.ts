import type { DatabaseSync } from 'node:sqlite'
import { estimateAt, type EstimateAnchor } from '~/utils/tier-ordinal'
import { LIST_SOURCES, sourceLabel } from '~/utils/list-source-catalog'

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
 * The backbone doubles as the anchor set: a level's target is read off the
 * agreeing levels around it on the source list, using the same estimator that
 * places a brand-new submission. So the suggestion is "put it where this list
 * says it goes, relative to the levels we already agree about".
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

/** Everything `source` would move, in the order worth reading. */
export function computeImportedMovements(db: DatabaseSync, source: string): {
  items: ImportedMovement[]
  shared: number
} {
  const shared = sharedWithAll(db, source)
  if (shared.length < 2) return { items: [], shared: shared.length }

  const agreeingIdx = new Set(longestIncreasingRun(shared.map((r) => r.position)))

  // The backbone is the anchor set. Indexed by source rank so a level 300 ranks
  // below an anchor is placed 300 ranks' worth below it, not merely "after".
  const anchors: EstimateAnchor[] = []
  for (const i of agreeingIdx) {
    const r = shared[i]!
    anchors.push({ index: r.source_position, placement: r.position, tierOrd: null })
  }
  anchors.sort((a, b) => a.index - b.index)

  const dismissals = loadDismissals(db, source)

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
    const est = estimateAt(anchors, r.source_position)
    if (est.placement == null || est.placement === r.position) continue

    const toPlacement = placementAt(est.placement)

    items.push({
      level_id: r.level_id,
      name: r.name,
      gd_id: r.gd_id,
      gddl_tier: r.gddl_tier,
      source_position: r.source_position,
      from_position: r.position,
      from_placement: r.sheet_placement,
      to_position: est.placement,
      to_placement: toPlacement,
      distance: est.placement - r.position,
      basis: est.basis,
      dismissed: dismissals.get(r.level_id) === r.source_position,
    })
  }

  // Biggest disagreements first — those are the ones worth a decision.
  items.sort((a, b) => Math.abs(b.distance) - Math.abs(a.distance))
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

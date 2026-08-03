import type { DatabaseSync } from 'node:sqlite'
import { TIER_MAX_NUMBER } from '~/utils/tier-ordinal'

export const ALLOWED_DIFFICULTIES = new Set([
  'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
])

export const TIER_RE = /^(Tier|Subtier) (\d{1,2})$/

export type ListKind = 'main' | 'void'

export type LevelLookup = { id: number; name: string; position: number }

export function lookupLevel(db: DatabaseSync, kind: ListKind, position: number): LevelLookup | null {
  const table = kind === 'void' ? 'void_levels' : 'levels'
  const row = db
    .prepare(`SELECT id, name, position FROM ${table} WHERE position = ?`)
    .get(position) as LevelLookup | undefined
  return row ?? null
}

export function lookupLevelById(db: DatabaseSync, kind: ListKind, levelId: number): LevelLookup | null {
  const table = kind === 'void' ? 'void_levels' : 'levels'
  const row = db
    .prepare(`SELECT id, name, position FROM ${table} WHERE id = ?`)
    .get(levelId) as LevelLookup | undefined
  return row ?? null
}

/**
 * Order tiers for median: Subtier 0..5 < Tier 1..TIER_MAX_NUMBER. Returns a
 * sortable index, or null for unknown labels.
 *
 * The number is capture group 2 — group 1 is the word "Tier" or "Subtier".
 * Reading group 1 as the number made every ordinal NaN, which survived the
 * `!= null` filter downstream and came back out of `tierFromOrdinal` as null,
 * so the community tier on every level silently never appeared.
 */
export function tierOrdinal(label: string | null): number | null {
  if (!label) return null
  const m = label.match(TIER_RE)
  if (!m) return null
  const n = Number(m[2])
  if (!Number.isFinite(n)) return null
  if (m[1] === 'Subtier') return n <= 5 ? n : null // 0..5
  return n >= 1 && n <= TIER_MAX_NUMBER ? 100 + n : null
}

/** Inverse of tierOrdinal — only used to render the picked median label. */
export function tierFromOrdinal(ord: number): string | null {
  if (ord < 100) {
    if (ord >= 0 && ord <= 5) return `Subtier ${ord}`
    return null
  }
  const n = ord - 100
  if (n >= 1 && n <= TIER_MAX_NUMBER) return `Tier ${n}`
  return null
}

/** Median of a sorted ascending number list; for even counts, picks the lower
 * element so the result is always one of the input tier ordinals. */
export function medianLow(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const i = Math.floor((sorted.length - 1) / 2)
  return sorted[i] ?? null
}

export type CommunityStats = {
  count: number
  community_tier: string | null
  community_enjoyment: number | null
  /** Map of tier label → count. Only populated when count meets distribution threshold. */
  distribution: Record<string, number> | null
}

/**
 * Aggregate approved opinions for a single level. Threshold rules from the
 * spec: main list needs 3+ approved opinions to surface community_tier /
 * enjoyment, void list needs only 1; bar-chart distribution needs 10+ for
 * main and 1+ for void.
 */
export function communityStats(
  db: DatabaseSync,
  kind: ListKind,
  levelId: number,
): CommunityStats {
  const rows = db
    .prepare(
      `SELECT gddl_tier, enjoyment FROM opinions
        WHERE list_kind = ? AND level_id = ? AND status = 'approved'`,
    )
    .all(kind, levelId) as { gddl_tier: string | null; enjoyment: number | null }[]

  const count = rows.length
  const showThreshold = kind === 'void' ? 1 : 3
  const distThreshold = kind === 'void' ? 1 : 10

  if (count < showThreshold) {
    return { count, community_tier: null, community_enjoyment: null, distribution: null }
  }

  // Median tier from ratings that supplied a recognizable label.
  const ords = rows
    .map((r) => tierOrdinal(r.gddl_tier))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b)
  const tier = ords.length ? tierFromOrdinal(medianLow(ords)!) : null

  // Average enjoyment across rows that supplied a value.
  const enjoyments = rows.map((r) => r.enjoyment).filter((n): n is number => n != null)
  const enjoyAvg = enjoyments.length
    ? enjoyments.reduce((a, b) => a + b, 0) / enjoyments.length
    : null

  let distribution: Record<string, number> | null = null
  if (count >= distThreshold) {
    distribution = {}
    for (const r of rows) {
      const key = r.gddl_tier ?? '—'
      distribution[key] = (distribution[key] ?? 0) + 1
    }
  }

  return { count, community_tier: tier, community_enjoyment: enjoyAvg, distribution }
}

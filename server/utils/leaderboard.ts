import type { DatabaseSync } from 'node:sqlite'

/**
 * Stats computed from a player's accepted records, used as a "modern" stand-in
 * when the player isn't on the sheet's leaderboard tab. The numbers mirror the
 * shape of the sheet's `players` row so callers can treat both kinds the same.
 *
 *   total_points = Σ level.points
 *   skill_points = Σ level.points · 0.95^(rank − 1), levels ranked by points DESC
 *   hardest      = name of the highest-points level
 *   tier         = gddl_tier of that hardest level
 */
export type DerivedStats = {
  name: string
  total_points: number
  skill_points: number
  hardest: string | null
  tier: string | null
}

const SKILL_FALLOFF = 0.95

type RawRow = {
  player_name: string
  points: number
  level_name: string
  gddl_tier: string | null
  position: number
}

/**
 * The sheet's leaderboard stores `tier` as a bare number ("32"); `levels.gddl_tier`
 * stores the full label ("Tier 32"). Strip the prefix so derived stats match the
 * format other parts of the site already expect.
 */
function normalizeTier(value: string | null | undefined): string | null {
  if (!value) return null
  const stripped = value.replace(/^\s*Tier\s+/i, '').trim()
  return stripped || null
}

function statsFromSortedRows(name: string, rows: RawRow[]): DerivedStats {
  let total = 0
  let skill = 0
  for (let i = 0; i < rows.length; i++) {
    total += rows[i]!.points
    skill += rows[i]!.points * Math.pow(SKILL_FALLOFF, i)
  }
  return {
    name,
    total_points: total,
    skill_points: skill,
    hardest: rows[0]?.level_name ?? null,
    tier: normalizeTier(rows[0]?.gddl_tier),
  }
}

/** Stats derived from records for a single player, regardless of whether they're on the leaderboard. */
export function computeDerivedStats(db: DatabaseSync, playerName: string): DerivedStats | null {
  const rows = db.prepare(
    `SELECT l.points, l.name AS level_name, l.gddl_tier, l.position
       FROM records r
       JOIN levels l ON l.id = r.level_id
      WHERE r.player_name = ? COLLATE NOCASE
        AND r.permanent = 1
        AND l.points IS NOT NULL
      ORDER BY l.points DESC, l.position ASC`,
  ).all(playerName) as Omit<RawRow, 'player_name'>[]
  if (rows.length === 0) return null
  return statsFromSortedRows(playerName, rows.map((r) => ({ ...r, player_name: playerName })))
}

/** Every player who has accepted records but no row in the `players` (leaderboard) table. */
export function listDerivedPlayers(db: DatabaseSync): DerivedStats[] {
  const rows = db.prepare(
    `SELECT r.player_name, l.points, l.name AS level_name, l.gddl_tier, l.position
       FROM records r
       JOIN levels l ON l.id = r.level_id
      WHERE r.permanent = 1
        AND l.points IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM players p WHERE p.name = r.player_name COLLATE NOCASE
            )
      ORDER BY LOWER(r.player_name) ASC, l.points DESC, l.position ASC`,
  ).all() as RawRow[]

  // Group by lowercase name (in case records use inconsistent casing). The
  // first row's casing wins as the display name.
  const groups = new Map<string, RawRow[]>()
  for (const r of rows) {
    const key = r.player_name.toLowerCase()
    let group = groups.get(key)
    if (!group) { group = []; groups.set(key, group) }
    group.push(r)
  }

  return Array.from(groups.values(), (group) => statsFromSortedRows(group[0]!.player_name, group))
}

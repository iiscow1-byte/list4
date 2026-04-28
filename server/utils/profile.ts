import type { DatabaseSync } from 'node:sqlite'

export type PlayerStats = {
  name: string
  country: string | null
  total_points: number
  skill_points: number
  hardest: string | null
  tier: string | null
}

export type LevelRow = {
  position: number
  name: string
  points: number | null
  gddl_tier: string | null
}

export type CompletedLevel = LevelRow & { percent: number }

export function getPlayerStats(db: DatabaseSync, name: string): PlayerStats | null {
  return db.prepare(
    `SELECT name, country, total_points, skill_points, hardest, tier
       FROM players WHERE name = ? COLLATE NOCASE`,
  ).get(name) as PlayerStats | null
}

export function getCompletedLevels(db: DatabaseSync, playerName: string): CompletedLevel[] {
  const player = db.prepare(`SELECT id FROM players WHERE name = ? COLLATE NOCASE`).get(playerName) as { id: number } | undefined
  if (!player) return []
  return db.prepare(
    `SELECT l.position, l.name, l.points, l.gddl_tier, r.percent
       FROM records r
       JOIN levels l ON l.id = r.level_id
      WHERE r.player_id = ? AND r.verified = 1
      ORDER BY l.position ASC`,
  ).all(player.id) as CompletedLevel[]
}

export function getCreatedLevels(db: DatabaseSync, creatorName: string): LevelRow[] {
  return db.prepare(
    `SELECT position, name, points, gddl_tier
       FROM levels WHERE creator = ? COLLATE NOCASE
      ORDER BY position ASC`,
  ).all(creatorName) as LevelRow[]
}

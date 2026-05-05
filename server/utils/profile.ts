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

export type CompletedLevel = LevelRow & { percent: number; main_skillset: string | null; record_id: number }

export function getPlayerStats(db: DatabaseSync, name: string): PlayerStats | null {
  return db.prepare(
    `SELECT name, country, total_points, skill_points, hardest, tier
       FROM players WHERE name = ? COLLATE NOCASE`,
  ).get(name) as PlayerStats | null
}

export function getCompletedLevels(db: DatabaseSync, playerName: string): CompletedLevel[] {
  // Sheet records are auto-accepted (permanent = 1) on import, and approved
  // user submissions are also permanent = 1, so a single filter covers both.
  // Pending user submissions (permanent = 0) stay hidden.
  return db.prepare(
    `SELECT l.position, l.name, l.points, l.gddl_tier, l.main_skillset, r.percent, r.id AS record_id
       FROM records r
       JOIN levels l ON l.id = r.level_id
      WHERE r.player_name = ? COLLATE NOCASE AND r.permanent = 1
      ORDER BY l.position ASC`,
  ).all(playerName) as CompletedLevel[]
}

export function getCreatedLevels(db: DatabaseSync, creatorName: string): LevelRow[] {
  // `creator` is a comma-separated list (e.g. "Knobbelboy, Riot"). Wrap both the
  // stored value and the search term with ", " delimiters so the LIKE only
  // matches whole tokens, not substrings.
  return db.prepare(
    `SELECT position, name, points, gddl_tier
       FROM levels
      WHERE creator IS NOT NULL
        AND (', ' || creator || ', ') LIKE ('%, ' || ? || ', %') COLLATE NOCASE
      ORDER BY position ASC`,
  ).all(creatorName) as LevelRow[]
}

export function getVerifiedLevels(db: DatabaseSync, verifierName: string): LevelRow[] {
  return db.prepare(
    `SELECT position, name, points, gddl_tier
       FROM levels
      WHERE verifier = ? COLLATE NOCASE
      ORDER BY position ASC`,
  ).all(verifierName) as LevelRow[]
}

export type ProgressPost = {
  id: number
  level_name: string
  level_position: number | null
  start_percent: number
  end_percent: number
  video_url: string | null
  created_at: string
}

export function getProgressPosts(db: DatabaseSync, accountId: number): ProgressPost[] {
  return db.prepare(
    `SELECT id, level_name, level_position, start_percent, end_percent, video_url, created_at
       FROM progress_posts
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT 200`,
  ).all(accountId) as ProgressPost[]
}

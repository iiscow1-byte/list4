import type { DatabaseSync } from 'node:sqlite'

/**
 * Resolve the canonical follow-target name for a profile reference.
 * - For an account username: prefer claimed_player, else the username itself.
 * - For a bare player name: use it as-is (validated against players/records/accounts).
 *
 * Returns null when the reference doesn't match any known profile, so callers
 * can 404 without distinguishing the lookup paths.
 */
export function resolveTargetName(db: DatabaseSync, raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const acc = db.prepare(
    `SELECT username, claimed_player FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(trimmed) as { username: string; claimed_player: string | null } | undefined
  if (acc) return acc.claimed_player ?? acc.username

  const player = db.prepare(
    `SELECT name FROM players WHERE name = ? COLLATE NOCASE`,
  ).get(trimmed) as { name: string } | undefined
  if (player) return player.name

  const rec = db.prepare(
    `SELECT player_name AS name FROM records WHERE player_name = ? COLLATE NOCASE LIMIT 1`,
  ).get(trimmed) as { name: string } | undefined
  if (rec) return rec.name

  return null
}

export function isFollowing(db: DatabaseSync, followerId: number, targetName: string): boolean {
  const row = db.prepare(
    `SELECT 1 FROM follows WHERE follower_account_id = ? AND target_name = ? COLLATE NOCASE`,
  ).get(followerId, targetName)
  return !!row
}

export function listFollowedNames(db: DatabaseSync, followerId: number): string[] {
  return (db.prepare(
    `SELECT target_name FROM follows WHERE follower_account_id = ?`,
  ).all(followerId) as { target_name: string }[]).map((r) => r.target_name)
}

import type { DatabaseSync } from 'node:sqlite'

/**
 * Scoring + leaderboard for custom lists running as full list sites.
 *
 * Points decay exponentially with rank, the shape every pointercrate-style
 * list uses: the #1 level is worth `max_points`, the last scored level is
 * worth `min_points`, and everything between follows a smooth curve. Because
 * the curve is anchored to the list's own length, a 12-level list and a
 * 400-level list both spread their points across the same range instead of
 * one of them bunching up at the bottom.
 *
 *   points(rank) = max * (min / max) ^ ((rank - 1) / (scored - 1))
 *
 * Levels past `scored_count` (when set) are worth nothing — the "legacy"
 * tail that lists keep around for history.
 *
 * A record at 100% earns the level's full value. A qualifying partial earns
 * that value scaled by how far it got, so chasing progress on a hard level
 * still shows up without ever beating an actual completion.
 */
export type ListScoreSettings = {
  max_points: number
  min_points: number
  /** 0 = every level scores. */
  scored_count: number
}

export function pointsForRank(rank: number, totalItems: number, s: ListScoreSettings): number {
  if (!Number.isInteger(rank) || rank < 1) return 0
  const scored = s.scored_count > 0 ? Math.min(s.scored_count, totalItems) : totalItems
  if (rank > scored) return 0
  if (scored <= 1) return round2(s.max_points)

  const max = Math.max(0, s.max_points)
  const min = Math.max(0, Math.min(s.min_points, max))
  // A zero floor would make the ratio undefined, so fall back to a linear ramp.
  if (min === 0) return round2(max * (1 - (rank - 1) / (scored - 1)))

  return round2(max * Math.pow(min / max, (rank - 1) / (scored - 1)))
}

/** Points a record is worth: full value at 100%, scaled for a partial. */
export function pointsForRecord(levelPoints: number, percent: number): number {
  if (percent >= 100) return round2(levelPoints)
  return round2(levelPoints * (Math.max(0, Math.min(100, percent)) / 100))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type LeaderboardRow = {
  rank: number
  player_name: string
  points: number
  completions: number
  progresses: number
  hardest_name: string | null
  hardest_rank: number | null
  account_username: string | null
}

/**
 * Rank every player holding an approved record on the list. Points come from
 * each record's level rank, so moving a level reshuffles the leaderboard the
 * next time it's read — no denormalised totals to keep in sync.
 */
export function buildLeaderboard(db: DatabaseSync, listId: number): LeaderboardRow[] {
  const settings = db.prepare(
    `SELECT max_points, min_points, scored_count FROM custom_lists WHERE id = ?`,
  ).get(listId) as ListScoreSettings | undefined
  if (!settings) return []

  const totalItems = (db.prepare(
    `SELECT COUNT(*) AS n FROM custom_list_items WHERE list_id = ?`,
  ).get(listId) as { n: number }).n
  if (totalItems === 0) return []

  // sort_order is 0-based; rank is 1-based.
  const rows = db.prepare(
    `SELECT r.player_name, r.percent, i.sort_order, i.name AS level_name,
            a.username AS account_username
       FROM custom_list_records r
       JOIN custom_list_items i ON i.id = r.item_id
       LEFT JOIN accounts a ON a.id = r.submitted_by
      WHERE r.list_id = ? AND r.status = 'approved'`,
  ).all(listId) as {
    player_name: string
    percent: number
    sort_order: number
    level_name: string
    account_username: string | null
  }[]

  type Acc = Omit<LeaderboardRow, 'rank'>
  const byPlayer = new Map<string, Acc>()

  for (const r of rows) {
    const rank = r.sort_order + 1
    const levelPoints = pointsForRank(rank, totalItems, settings)
    const earned = pointsForRecord(levelPoints, r.percent)
    const key = r.player_name.toLowerCase()

    let acc = byPlayer.get(key)
    if (!acc) {
      acc = {
        player_name: r.player_name,
        points: 0,
        completions: 0,
        progresses: 0,
        hardest_name: null,
        hardest_rank: null,
        account_username: null,
      }
      byPlayer.set(key, acc)
    }
    acc.points = Math.round((acc.points + earned) * 100) / 100
    if (r.percent >= 100) acc.completions++
    else acc.progresses++
    // "Hardest" = the best-placed level they've actually completed.
    if (r.percent >= 100 && (acc.hardest_rank === null || rank < acc.hardest_rank)) {
      acc.hardest_rank = rank
      acc.hardest_name = r.level_name
    }
    if (!acc.account_username && r.account_username) acc.account_username = r.account_username
  }

  return Array.from(byPlayer.values())
    .sort((a, b) => b.points - a.points || b.completions - a.completions
      || a.player_name.localeCompare(b.player_name))
    .map((row, i) => ({ rank: i + 1, ...row }))
}

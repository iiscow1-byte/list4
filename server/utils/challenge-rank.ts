import type { DatabaseSync } from 'node:sqlite'
import { isChallengeSql } from './challenge-expr'

/**
 * Challenge rank for every challenge on the list, cached between requests.
 *
 * A level's challenge rank is its place among challenges *only*, so working one
 * out means walking the whole list. `/api/levels` did exactly that on every
 * request, whether the caller cared about challenge ranks or not: a
 * 54,000-row scan evaluating the challenge expression per row, sorted, to
 * attach a number to the fifty rows of one page.
 *
 * It is cached against a stamp built from the list's shape — how many levels
 * there are, the newest id, and the highest position. Anything that adds,
 * removes or renumbers a level moves it, so the map can't outlive the list it
 * describes, and an ordinary browse pays for the scan once instead of once per
 * page.
 *
 * Marking a level as a challenge by hand changes the ranking *without* changing
 * the list's shape, so that path calls `invalidateChallengeRanks` directly.
 */
const IS_CHALLENGE_SQL = isChallengeSql('', 'c')

let cache: { stamp: number; map: Map<number, number> } | null = null

function listStamp(db: DatabaseSync): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt, MAX(id) AS maxid, MAX(position) AS maxpos FROM levels`,
  ).get() as { cnt: number; maxid: number | null; maxpos: number | null }
  return (row.cnt ?? 0) * 1_000_000_000 + (row.maxid ?? 0) * 1_000 + (row.maxpos ?? 0)
}

export function getChallengeRankMap(db: DatabaseSync): Map<number, number> {
  const stamp = listStamp(db)
  if (cache && cache.stamp === stamp) return cache.map
  const positions = (db.prepare(
    `SELECT position FROM levels LEFT JOIN gd_info_cache c ON c.gd_id = levels.gd_id
      WHERE (${IS_CHALLENGE_SQL}) ORDER BY position ASC`,
  ).all() as { position: number }[]).map((r) => r.position)
  const map = new Map<number, number>(positions.map((pos, i) => [pos, i + 1]))
  cache = { stamp, map }
  return map
}

export function invalidateChallengeRanks(): void {
  cache = null
}

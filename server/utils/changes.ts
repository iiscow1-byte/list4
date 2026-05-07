import type { DatabaseSync } from 'node:sqlite'

/**
 * Record a level being added to the main list at `position`. Stored in
 * `position_history` with `from_position = NULL`, matching the convention
 * already used by the level-detail page's history view and the recent-changes
 * feed on the about page.
 */
export function recordPlacement(
  db: DatabaseSync,
  levelId: number,
  position: number,
  accountId: number | null,
): void {
  db.prepare(
    `INSERT INTO position_history (level_id, from_position, to_position, changed_by)
     VALUES (?, NULL, ?, ?)`,
  ).run(levelId, position, accountId)
}

export type ChangeKind = 'add' | 'move'
export type Change = {
  kind: ChangeKind
  level_id: number           // levels.id — used for admin changelog deletion
  level_position: number     // current position on the main list (for linking)
  level_name: string
  level_gddl_tier: string | null
  level_rated: string | null // e.g. 'Challenge', 'Featured', etc.
  challenge_rank: number | null // rank among challenge-rated levels (1=hardest), null if not a challenge
  from_position: number | null
  to_position: number
  changed_at: string         // raw datetime('now') from SQLite, UTC
  changed_by: string | null  // username, null for system / deleted account
}
export type DayGroup = {
  date: string               // YYYY-MM-DD (UTC)
  changes: Change[]
}

/**
 * Pull change rows joined with the current level row so we can render a link
 * to the level page. Levels that have been deleted (CASCADE removed their
 * history too) won't appear at all. `since`/`until` bound the range
 * inclusively in `YYYY-MM-DD HH:MM:SS` UTC form (or YYYY-MM-DD which SQLite
 * compares lexicographically).
 */
export function loadChanges(
  db: DatabaseSync,
  opts: { since?: string; until?: string; limit?: number } = {},
): Change[] {
  const conds: string[] = []
  const params: any[] = []
  if (opts.since) { conds.push('h.changed_at >= ?'); params.push(opts.since) }
  if (opts.until) { conds.push('h.changed_at <= ?'); params.push(opts.until) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000))

  const rows = db.prepare(
    `SELECT h.level_id, h.from_position, h.to_position, h.changed_at,
            l.position AS level_position, l.name AS level_name, l.gddl_tier AS level_gddl_tier,
            l.rated AS level_rated,
            CASE WHEN l.rated = 'Challenge'
              THEN (SELECT COUNT(*) FROM levels l2 WHERE l2.rated = 'Challenge' AND l2.position <= l.position)
              ELSE NULL
            END AS challenge_rank,
            a.username AS changed_by
       FROM position_history h
       JOIN levels   l ON l.id = h.level_id
       LEFT JOIN accounts a ON a.id = h.changed_by
       ${where}
       ORDER BY h.changed_at DESC, h.id DESC
       LIMIT ?`,
  ).all(...params, limit) as Array<{
    level_id: number
    from_position: number | null
    to_position: number
    changed_at: string
    level_position: number
    level_name: string
    level_gddl_tier: string | null
    level_rated: string | null
    challenge_rank: number | null
    changed_by: string | null
  }>

  // Condense multiple same-day entries for the same level into one.
  // Groups are ordered: if a level was moved A→B then B→C on the same UTC day,
  // we emit a single A→C entry using the earliest from_position and latest
  // to_position. If a level was added and then moved same day, the "add" entry
  // wins but its to_position is updated to the final resting place.
  type Row = (typeof rows)[0]
  const byKey = new Map<string, Row[]>()
  for (const row of rows) {
    const k = `${row.level_id}:${row.changed_at.slice(0, 10)}`
    const bucket = byKey.get(k)
    if (bucket) bucket.push(row)
    else byKey.set(k, [row])
  }

  const condensed: Row[] = []
  for (const bucket of byKey.values()) {
    if (bucket.length === 1) {
      condensed.push(bucket[0]!)
      continue
    }
    // Sort oldest-first so we read the move chain in order.
    bucket.sort((a, b) => (a.changed_at < b.changed_at ? -1 : a.changed_at > b.changed_at ? 1 : 0))
    const first = bucket[0]!
    const last = bucket[bucket.length - 1]!
    if (first.from_position === null) {
      // Level added and moved same day — show the add with the final position.
      condensed.push({ ...first, to_position: last.to_position, changed_at: last.changed_at })
    } else {
      // Multiple moves — earliest from → latest to, use latest metadata.
      condensed.push({ ...last, from_position: first.from_position })
    }
  }

  // Restore newest-first order after grouping.
  condensed.sort((a, b) => (b.changed_at > a.changed_at ? 1 : b.changed_at < a.changed_at ? -1 : 0))

  // Drop net-zero moves: level moved but ended up back at its original position.
  return condensed.filter((r) => r.from_position === null || r.from_position !== r.to_position).map((r) => ({
    kind: r.from_position == null ? 'add' : 'move',
    level_id: r.level_id,
    level_position: r.level_position,
    level_name: r.level_name,
    level_gddl_tier: r.level_gddl_tier,
    level_rated: r.level_rated,
    challenge_rank: r.challenge_rank,
    from_position: r.from_position,
    to_position: r.to_position,
    changed_at: r.changed_at,
    changed_by: r.changed_by,
  }))
}

/** Group an already-sorted (newest-first) change list by UTC date. */
export function groupByDay(changes: Change[]): DayGroup[] {
  const map = new Map<string, Change[]>()
  for (const c of changes) {
    const date = c.changed_at.slice(0, 10) // YYYY-MM-DD
    let bucket = map.get(date)
    if (!bucket) { bucket = []; map.set(date, bucket) }
    bucket.push(c)
  }
  return Array.from(map.entries()).map(([date, list]) => ({ date, changes: list }))
}

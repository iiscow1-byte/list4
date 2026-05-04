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
  level_position: number     // current position on the main list (for linking)
  level_name: string
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
    `SELECT h.from_position, h.to_position, h.changed_at,
            l.position AS level_position, l.name AS level_name,
            a.username AS changed_by
       FROM position_history h
       JOIN levels   l ON l.id = h.level_id
       LEFT JOIN accounts a ON a.id = h.changed_by
       ${where}
       ORDER BY h.changed_at DESC, h.id DESC
       LIMIT ?`,
  ).all(...params, limit) as Array<{
    from_position: number | null
    to_position: number
    changed_at: string
    level_position: number
    level_name: string
    changed_by: string | null
  }>

  return rows.map((r) => ({
    kind: r.from_position == null ? 'add' : 'move',
    level_position: r.level_position,
    level_name: r.level_name,
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

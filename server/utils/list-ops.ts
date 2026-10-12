import type { DatabaseSync } from 'node:sqlite'
import { recomputePoints } from './points.ts'
import { invalidateChallengeRanks } from './challenge-rank.ts'
import { recordPlacement, recordRemoval } from './changes.ts'

/**
 * Every change to the order of the main list goes through this file.
 *
 * Rules that hold for all of them:
 * - `position` is the level's rank, 1..N with no gaps, and it is the number the
 *   site prints. `sheet_placement` is kept equal to it for older queries.
 * - A level staff place by hand is `pinned`: the sheet refresh keeps it next to
 *   the level above it until the sheet itself moves that level.
 * - A level staff remove gets a tombstone so the refresh doesn't add it back
 *   while the sheet still lists it.
 * - One changelog row per level per day.
 */

const STASH = -1_000_000_000

/** Sheet columns that can be overridden on the site. */
export const SHEET_FIELDS = [
  'name', 'gd_id', 'gddl_tier', 'difficulty', 'placement_source', 'main_skillset',
  'verify_date', 'verification', 'verification_url', 'year_verified',
] as const
export type SheetField = (typeof SHEET_FIELDS)[number]

// ---------------------------------------------------------------- transactions

let savepointDepth = 0

/**
 * Run `fn` atomically. Uses savepoints, so it nests inside another `tx` or an
 * outer `BEGIN` without SQLite complaining about a transaction in a transaction.
 */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  const name = `list_ops_${++savepointDepth}`
  db.exec(`SAVEPOINT ${name}`)
  try {
    const out = fn()
    db.exec(`RELEASE ${name}`)
    return out
  } catch (e) {
    db.exec(`ROLLBACK TO ${name}`)
    db.exec(`RELEASE ${name}`)
    throw e
  } finally {
    savepointDepth--
  }
}

// ---------------------------------------------------------------- site_fields

export function parseSiteFields(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set()
  try {
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((f) => typeof f === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSiteFields(db: DatabaseSync, levelId: number, fields: Set<string>): void {
  const value = fields.size ? JSON.stringify([...fields].sort()) : null
  db.prepare(`UPDATE levels SET site_fields = ? WHERE id = ?`).run(value, levelId)
}

export function addSiteFields(db: DatabaseSync, levelId: number, fields: string[]): void {
  if (!fields.length) return
  const row = db.prepare(`SELECT site_fields FROM levels WHERE id = ?`).get(levelId) as { site_fields: string | null } | undefined
  if (!row) return
  const set = parseSiteFields(row.site_fields)
  const before = set.size
  for (const f of fields) set.add(f)
  if (set.size !== before) writeSiteFields(db, levelId, set)
}

/** Let the sheet own these fields again (all of them when `fields` is omitted). */
export function clearSiteFields(db: DatabaseSync, levelId: number, fields?: string[]): void {
  if (!fields) {
    db.prepare(`UPDATE levels SET site_fields = NULL WHERE id = ?`).run(levelId)
    return
  }
  const row = db.prepare(`SELECT site_fields FROM levels WHERE id = ?`).get(levelId) as { site_fields: string | null } | undefined
  if (!row) return
  const set = parseSiteFields(row.site_fields)
  for (const f of fields) set.delete(f)
  writeSiteFields(db, levelId, set)
}

// ---------------------------------------------------------------- bookkeeping

/** Keep the printed number equal to the position. Returns rows changed. */
export function syncDisplayNumbers(db: DatabaseSync): number {
  return Number(db.prepare(
    `UPDATE levels SET sheet_placement = position WHERE sheet_placement IS NOT position`,
  ).run().changes)
}

const listeners = new Set<() => void>()

/** Register a cache that has to be dropped whenever the list changes. */
export function onListChange(fn: () => void): void {
  listeners.add(fn)
}

/**
 * A counter clients poll to know the list changed. Kept in `site_settings` so it
 * survives restarts and is shared with CLI imports.
 */
export function listVersion(db: DatabaseSync): number {
  const row = db.prepare(`SELECT value FROM site_settings WHERE key = 'list_version'`).get() as { value: string } | undefined
  return row ? Number(row.value) || 0 : 0
}

function bumpListVersion(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('list_version', '1', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1, updated_at = excluded.updated_at`,
  ).run()
}

/**
 * Call once after any change to the list's order or membership: numbers,
 * points, cached rankings and the version stamp all follow from the order.
 */
export function afterListChange(db: DatabaseSync, opts: { points?: boolean } = {}): void {
  // recomputePoints opens its own transaction.
  if (savepointDepth > 0) throw new Error('afterListChange must run after the transaction, not inside it')
  syncDisplayNumbers(db)
  if (opts.points !== false) recomputePoints(db)
  invalidateChallengeRanks()
  bumpListVersion(db)
  for (const fn of listeners) {
    try { fn() } catch { /* a cache failing to clear must not fail the write */ }
  }
}

function maxPosition(db: DatabaseSync): number {
  return (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
}

/** Shift everything at or below `pos` down one. */
function openSlot(db: DatabaseSync, pos: number): void {
  db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ?`).run(pos)
  db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
}

/** Shift everything below `pos` up one. */
function closeGap(db: DatabaseSync, pos: number): void {
  db.prepare(`UPDATE levels SET position = -(position - 1) WHERE position > ?`).run(pos)
  db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
}

/** One changelog row per level per day: a second move today edits the first. */
function logMove(db: DatabaseSync, levelId: number, from: number, to: number, actorId: number | null): void {
  const today = db.prepare(
    `SELECT id, from_position FROM position_history
      WHERE level_id = ? AND from_position IS NOT NULL AND source = 'all'
        AND DATE(changed_at) = DATE('now')
      ORDER BY changed_at ASC, id ASC LIMIT 1`,
  ).get(levelId) as { id: number; from_position: number } | undefined

  if (!today) {
    db.prepare(
      `INSERT INTO position_history (level_id, from_position, to_position, changed_by) VALUES (?, ?, ?, ?)`,
    ).run(levelId, from, to, actorId)
    return
  }
  db.prepare(
    `DELETE FROM position_history
      WHERE level_id = ? AND from_position IS NOT NULL AND source = 'all'
        AND DATE(changed_at) = DATE('now') AND id != ?`,
  ).run(levelId, today.id)
  if (today.from_position === to) {
    // Moved back to where it started the day: nothing happened, as far as
    // anyone reading the changelog is concerned.
    db.prepare(`DELETE FROM position_history WHERE id = ?`).run(today.id)
  } else {
    db.prepare(
      `UPDATE position_history SET to_position = ?, changed_at = datetime('now'), changed_by = ? WHERE id = ?`,
    ).run(to, actorId, today.id)
  }
}

// ---------------------------------------------------------------- tiers

/**
 * The tier a slot implies: the nearest tiered level above or below, the closer
 * one winning and the one above winning a tie. Null when nothing nearby has one.
 */
export function tierForSlot(db: DatabaseSync, position: number, excludeLevelId: number): string | null {
  const above = db.prepare(
    `SELECT position, gddl_tier FROM levels
      WHERE position < ? AND id != ? AND gddl_tier IS NOT NULL AND gddl_tier != ''
      ORDER BY position DESC LIMIT 1`,
  ).get(position, excludeLevelId) as { position: number; gddl_tier: string } | undefined
  const below = db.prepare(
    `SELECT position, gddl_tier FROM levels
      WHERE position > ? AND id != ? AND gddl_tier IS NOT NULL AND gddl_tier != ''
      ORDER BY position ASC LIMIT 1`,
  ).get(position, excludeLevelId) as { position: number; gddl_tier: string } | undefined

  if (!above && !below) return null
  if (!above) return below!.gddl_tier
  if (!below) return above.gddl_tier
  if (above.gddl_tier === below.gddl_tier) return above.gddl_tier
  return position - above.position <= below.position - position ? above.gddl_tier : below.gddl_tier
}

// ---------------------------------------------------------------- moves

export type MoveOptions = {
  /** Leave `gddl_tier` alone instead of taking the slot's tier. */
  keepTier?: boolean
  /** Keep the move through sheet refreshes. Default true. */
  pin?: boolean
}

export type MoveResult = {
  id: number
  from: number
  to: number
  moved: boolean
  tier_from?: string | null
  tier_to?: string | null
}

/**
 * Move whatever sits at `fromPos` to `toPos`, shifting the levels in between.
 * Does not recompute points; call `afterListChange` once after a batch.
 */
export function moveLevel(
  db: DatabaseSync,
  fromPos: number,
  toPos: number,
  actorId: number | null,
  opts: MoveOptions = {},
): MoveResult {
  const level = db.prepare(`SELECT id, gddl_tier FROM levels WHERE position = ?`)
    .get(fromPos) as { id: number; gddl_tier: string | null } | undefined
  if (!level) throw new Error(`No level sits at #${fromPos}.`)

  const target = Math.max(1, Math.min(toPos, maxPosition(db)))
  if (target === fromPos) return { id: level.id, from: fromPos, to: fromPos, moved: false }

  return tx(db, () => {
    db.prepare(`UPDATE levels SET position = ? WHERE id = ?`).run(STASH, level.id)
    if (target < fromPos) {
      db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ? AND position < ?`).run(target, fromPos)
    } else {
      db.prepare(`UPDATE levels SET position = -(position - 1) WHERE position > ? AND position <= ?`).run(fromPos, target)
    }
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0 AND position != ?`).run(STASH)
    db.prepare(
      `UPDATE levels SET position = ?, tentative_placement = 0,
              pinned = CASE WHEN ? THEN 1 ELSE pinned END,
              pinned_at = CASE WHEN ? THEN datetime('now') ELSE pinned_at END
        WHERE id = ?`,
    ).run(target, opts.pin === false ? 0 : 1, opts.pin === false ? 0 : 1, level.id)

    let tierTo: string | null = null
    if (!opts.keepTier) {
      const landed = tierForSlot(db, target, level.id)
      if (landed && landed !== level.gddl_tier) {
        db.prepare(`UPDATE levels SET gddl_tier = ? WHERE id = ?`).run(landed, level.id)
        // The tier now describes the slot staff chose, so it is the site's
        // until the sheet moves the level.
        addSiteFields(db, level.id, ['gddl_tier'])
        tierTo = landed
      }
    }

    logMove(db, level.id, fromPos, target, actorId)

    return tierTo
      ? { id: level.id, from: fromPos, to: target, moved: true, tier_from: level.gddl_tier, tier_to: tierTo }
      : { id: level.id, from: fromPos, to: target, moved: true }
  })
}

/** Move one level by id directly below another (or to the top when `belowId` is null). */
export function moveLevelBelow(
  db: DatabaseSync,
  levelId: number,
  belowId: number | null,
  actorId: number | null,
  opts: MoveOptions = {},
): MoveResult {
  const pos = positionOf(db, levelId)
  if (pos == null) throw new Error('That level no longer exists.')
  if (belowId === levelId) return { id: levelId, from: pos, to: pos, moved: false }
  if (belowId == null) return moveLevel(db, pos, 1, actorId, opts)
  const anchor = positionOf(db, belowId)
  if (anchor == null) throw new Error('The level to place it under no longer exists.')
  return moveLevel(db, pos, pos > anchor ? anchor + 1 : anchor, actorId, opts)
}

/**
 * Move several levels as a block, in their current order, directly below
 * `belowId` (top of the list when null).
 */
export function moveLevelsBelow(
  db: DatabaseSync,
  ids: number[],
  belowId: number | null,
  actorId: number | null,
  opts: MoveOptions = {},
): { moved: number; retiered: number } {
  const unique = [...new Set(ids)].filter((id) => id !== belowId)
  const ordered = unique
    .map((id) => ({ id, pos: positionOf(db, id) }))
    .filter((r): r is { id: number; pos: number } => r.pos != null)
    .sort((a, b) => a.pos - b.pos)

  return tx(db, () => {
    let moved = 0
    let retiered = 0
    let after = belowId
    for (const { id } of ordered) {
      const res = moveLevelBelow(db, id, after, actorId, opts)
      if (res.moved) moved++
      if (res.tier_to) retiered++
      after = id
    }
    return { moved, retiered }
  })
}

export function positionOf(db: DatabaseSync, levelId: number): number | null {
  const row = db.prepare(`SELECT position FROM levels WHERE id = ?`).get(levelId) as { position: number } | undefined
  return row?.position ?? null
}

/**
 * Hand a level's placement back to the sheet: drop the pin and the tier it took
 * from its slot, and put it where the sheet's own order has it relative to the
 * levels around it.
 */
export function unpinLevel(db: DatabaseSync, levelId: number, actorId: number | null): MoveResult | null {
  const level = db.prepare(`SELECT id, position, sheet_rank FROM levels WHERE id = ?`)
    .get(levelId) as { id: number; position: number; sheet_rank: number | null } | undefined
  if (!level) return null

  return tx(db, () => {
    db.prepare(`UPDATE levels SET pinned = 0, pinned_at = NULL WHERE id = ?`).run(levelId)
    clearSiteFields(db, levelId, ['gddl_tier'])
    if (level.sheet_rank == null) return null
    // The sheet level that comes right before this one on the sheet.
    const prev = db.prepare(
      `SELECT id FROM levels WHERE sheet_rank < ? AND id != ? AND pinned = 0
        ORDER BY sheet_rank DESC LIMIT 1`,
    ).get(level.sheet_rank, levelId) as { id: number } | undefined
    return moveLevelBelow(db, levelId, prev?.id ?? null, actorId, { pin: false, keepTier: true })
  })
}

// ---------------------------------------------------------------- membership

export type NewLevel = Record<string, string | number | null>

/**
 * Put a new level on the list at `pos` and log it as added. The level is the
 * site's (`permanent`, `site_only`) and pinned where it was put.
 */
export function insertLevelAt(db: DatabaseSync, pos: number, fields: NewLevel, actorId: number | null): { id: number; position: number } {
  return tx(db, () => {
    const at = Math.max(1, Math.min(pos, maxPosition(db) + 1))
    openSlot(db, at)
    const row: NewLevel = {
      category: 'classic',
      permanent: 1,
      site_only: 1,
      pinned: 1,
      ...fields,
      position: at,
      sheet_placement: at,
    }
    const cols = Object.keys(row)
    const result = db.prepare(
      `INSERT INTO levels (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(...cols.map((c) => row[c] ?? null))
    db.prepare(`UPDATE levels SET pinned_at = datetime('now') WHERE id = ?`).run(Number(result.lastInsertRowid))
    const id = Number(result.lastInsertRowid)
    recordPlacement(db, id, at, actorId)
    // Staff are adding it back, so a removal recorded earlier no longer applies.
    clearTombstones(db, fields.gd_id as number | null, String(fields.name ?? ''))
    return { id, position: at }
  })
}

/**
 * Take a level off the list. Logged in `level_removals` for the changelog, and
 * tombstoned when the sheet still lists it so the next refresh doesn't put it
 * back.
 */
export function removeLevel(
  db: DatabaseSync,
  levelId: number,
  actorId: number | null,
  opts: { reason?: string | null } = {},
): { position: number; name: string } {
  const level = db.prepare(`SELECT id, position, name, gd_id, site_only FROM levels WHERE id = ?`)
    .get(levelId) as { id: number; position: number; name: string; gd_id: number | null; site_only: number } | undefined
  if (!level) throw new Error('No such level.')

  return tx(db, () => {
    recordRemoval(db, level.id, actorId, opts.reason ?? null)
    if (!level.site_only) {
      db.prepare(`INSERT INTO level_tombstones (gd_id, name, removed_by) VALUES (?, ?, ?)`)
        .run(level.gd_id, level.name, actorId)
    }
    db.prepare(`DELETE FROM levels WHERE id = ?`).run(level.id)
    closeGap(db, level.position)
    return { position: level.position, name: level.name }
  })
}

function clearTombstones(db: DatabaseSync, gdId: number | null, name: string): void {
  if (gdId != null) db.prepare(`DELETE FROM level_tombstones WHERE gd_id = ?`).run(gdId)
  else if (name) db.prepare(`DELETE FROM level_tombstones WHERE gd_id IS NULL AND name = ? COLLATE NOCASE`).run(name)
}

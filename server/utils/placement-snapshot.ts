import type { DatabaseSync } from 'node:sqlite'
import { resyncPlacements } from './placement-sync'

/**
 * Placements as a file you can put back.
 *
 * The list's order is the one piece of state here that isn't recoverable from
 * anywhere else. The sheet can be re-imported, the mirrors re-fetched, the
 * points recomputed — but a bad reorder, an import that renumbered more than it
 * should have, or an afternoon of moves that turned out wrong leaves nothing to
 * go back to. A snapshot is a plain file of "which level sits where", and
 * restoring it is the inverse.
 *
 * Two shapes, both accepted on the way back in:
 *   - JSON, the faithful record, with the ids that make matching exact.
 *   - CSV, for editing. Open it, retype some numbers, feed it back.
 *
 * Restoring is deliberately *not* "set position = whatever the file said".
 * Positions are UNIQUE and dense-ish, the file may be stale, and the list may
 * have gained levels since. What the file really carries is an *ordering*, so
 * that is what gets applied: the rows named in the file are laid out in the
 * order the file puts them, and rows the file has never heard of stay next to
 * the neighbour they currently follow instead of being swept to the bottom.
 */

/**
 * `gddl_tier` rides along because a move now rewrites it: a level dragged into
 * a different band takes that band's tier. Without the tier in the file, a
 * restore would put the level back and leave it labelled with the tier of the
 * place it no longer is.
 */
export type SnapshotLevel = {
  id: number
  position: number
  sheet_placement: number | null
  gd_id: number | null
  name: string
  gddl_tier: string | null
}

export type Snapshot = {
  format: 'all-placements'
  version: 1
  generated_at: string
  count: number
  levels: SnapshotLevel[]
}

export const SNAPSHOT_FORMAT = 'all-placements'

/** Every level and where it sits, in list order. */
export function buildSnapshot(db: DatabaseSync): Snapshot {
  const levels = db.prepare(
    `SELECT id, position, sheet_placement, gd_id, name, gddl_tier
       FROM levels
      ORDER BY position ASC`,
  ).all() as SnapshotLevel[]

  return {
    format: SNAPSHOT_FORMAT,
    version: 1,
    generated_at: new Date().toISOString(),
    count: levels.length,
    levels,
  }
}

// --- CSV ---------------------------------------------------------------

const CSV_HEADER = ['position', 'sheet_placement', 'level_id', 'gd_id', 'name', 'tier']

/**
 * A cell a spreadsheet will not reinterpret.
 *
 * A level called `=cmd` or `-Rest` is a formula to Excel, and level names on
 * this list are arbitrary user text, so the leading apostrophe is not
 * paranoia — it is the difference between a name and an executed cell.
 */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function snapshotToCsv(snap: Snapshot): string {
  const lines = [CSV_HEADER.join(',')]
  for (const l of snap.levels) {
    lines.push(
      [l.position, l.sheet_placement ?? '', l.id, l.gd_id ?? '', l.name, l.gddl_tier ?? '']
        .map(csvCell).join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

/** One row of a CSV, honouring quotes and embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// --- Parsing a file back in --------------------------------------------

/** What a restore actually needs from each row: who, and in what order. */
export type SnapshotEntry = {
  id: number | null
  gd_id: number | null
  name: string | null
  position: number | null
  sheet_placement: number | null
  /** Absent in an older file, which then simply leaves tiers alone. */
  gddl_tier: string | null
  /** Position in the file, used to keep equal `position` values stable. */
  ordinal: number
}

export type ParsedSnapshot = {
  entries: SnapshotEntry[]
  /** 'json' or 'csv' — reported back so the UI can say what it read. */
  kind: 'json' | 'csv'
  generated_at: string | null
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).trim())
  return Number.isInteger(n) ? n : null
}

function textOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, 40) : null
}

/**
 * Read a snapshot from whatever the admin uploaded.
 *
 * Sniffed rather than declared: an admin who exported CSV, edited it and
 * uploaded it again should not have to tell us which button they pressed.
 */
export function parseSnapshot(text: string): ParsedSnapshot {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('The file is empty.')

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: any
    try { data = JSON.parse(trimmed) } catch { throw new Error('That file is not valid JSON.') }
    const levels = Array.isArray(data) ? data : data?.levels
    if (!Array.isArray(levels)) {
      throw new Error('No `levels` array in that file — is it a placement snapshot?')
    }
    if (!Array.isArray(data) && data.format && data.format !== SNAPSHOT_FORMAT) {
      throw new Error(`That file says it is "${String(data.format).slice(0, 40)}", not a placement snapshot.`)
    }
    const entries = levels.map((l: any, i: number): SnapshotEntry => ({
      id: intOrNull(l?.id ?? l?.level_id),
      gd_id: intOrNull(l?.gd_id),
      name: typeof l?.name === 'string' && l.name.trim() ? l.name.trim() : null,
      position: intOrNull(l?.position),
      sheet_placement: intOrNull(l?.sheet_placement),
      gddl_tier: textOrNull(l?.gddl_tier ?? l?.tier),
      ordinal: i,
    }))
    return { entries, kind: 'json', generated_at: typeof data?.generated_at === 'string' ? data.generated_at : null }
  }

  const rows = parseCsv(trimmed)
  if (rows.length < 2) throw new Error('That CSV has no rows under its header.')
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/^﻿/, ''))
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n)
      if (i !== -1) return i
    }
    return -1
  }
  const iPos = col('position')
  const iPlace = col('sheet_placement', 'placement', 'sheet placement')
  const iId = col('level_id', 'id')
  const iGd = col('gd_id', 'gdid', 'level id')
  const iName = col('name', 'level', 'level_name')
  const iTier = col('tier', 'gddl_tier', 'gddl tier')

  if (iId === -1 && iGd === -1 && iName === -1) {
    throw new Error('That CSV has no level_id, gd_id or name column, so its rows can\'t be matched to levels.')
  }
  if (iPos === -1 && iPlace === -1) {
    throw new Error('That CSV has no position or sheet_placement column, so it doesn\'t say what order to use.')
  }

  const at = (r: string[], i: number) => (i === -1 ? null : r[i] ?? null)
  // A cell the CSV writer defended against formula injection carries a leading
  // apostrophe; strip it so a round trip through a spreadsheet still matches.
  const unguard = (s: string | null) => (s == null ? null : s.replace(/^'/, ''))

  const entries = rows.slice(1).map((r, i): SnapshotEntry => ({
    id: intOrNull(at(r, iId)),
    gd_id: intOrNull(at(r, iGd)),
    name: (() => {
      const v = unguard(at(r, iName))
      return v && v.trim() ? v.trim() : null
    })(),
    position: intOrNull(at(r, iPos)),
    sheet_placement: intOrNull(at(r, iPlace)),
    gddl_tier: textOrNull(unguard(at(r, iTier))),
    ordinal: i,
  }))
  return { entries, kind: 'csv', generated_at: null }
}

// --- Applying ----------------------------------------------------------

/**
 * Positions, not placements. The displayed number belongs to the slot and is
 * redistributed after the reorder, so it isn't knowable per level until the
 * write has happened — and a preview quoting a number it would have to invent
 * is worse than one quoting the row order it is actually changing.
 */
export type RestoreMove = {
  level_id: number
  name: string
  gd_id: number | null
  from_position: number
  to_position: number
}

export type RestoreResult = {
  /** Rows in the file that resolved to a level here. */
  matched: number
  /** Rows in the file that didn't. */
  unmatched: number
  /** Levels here the file never mentioned; they keep their neighbours. */
  untouched_extra: number
  moved: number
  /** Levels whose tier the file also puts back. Zero for a file without tiers. */
  retiered: number
  /** The biggest movements, for the confirmation screen. */
  sample: RestoreMove[]
  applied: boolean
}

type LevelRow = {
  id: number; position: number; sheet_placement: number | null
  gd_id: number | null; name: string; gddl_tier: string | null
}

/**
 * Match a file's rows to the levels that are actually here.
 *
 * `id` is exact and is tried first. Everything after it exists because a
 * snapshot may outlive the row it described — a level deleted and re-imported
 * comes back with a new id but the same GD id and name. A gd_id alone is not
 * unique (Solo/2P and Old/Unnerfed variants legitimately share one), so it only
 * counts when it lands on exactly one row.
 */
function matchEntries(entries: SnapshotEntry[], levels: LevelRow[]) {
  const byId = new Map<number, LevelRow>()
  const byGdName = new Map<string, LevelRow[]>()
  const byGd = new Map<number, LevelRow[]>()
  const byName = new Map<string, LevelRow[]>()
  const push = <K>(m: Map<K, LevelRow[]>, k: K, v: LevelRow) => {
    const b = m.get(k)
    if (b) b.push(v)
    else m.set(k, [v])
  }
  for (const l of levels) {
    byId.set(l.id, l)
    if (l.gd_id != null) {
      push(byGd, l.gd_id, l)
      push(byGdName, `${l.gd_id}|${l.name.toLowerCase()}`, l)
    }
    push(byName, l.name.toLowerCase(), l)
  }

  const taken = new Set<number>()
  const matched: { entry: SnapshotEntry; level: LevelRow }[] = []
  const unmatched: SnapshotEntry[] = []

  const claim = (entry: SnapshotEntry, level: LevelRow | undefined): boolean => {
    if (!level || taken.has(level.id)) return false
    taken.add(level.id)
    matched.push({ entry, level })
    return true
  }
  const only = (rows: LevelRow[] | undefined): LevelRow | undefined => {
    const free = (rows ?? []).filter((r) => !taken.has(r.id))
    return free.length === 1 ? free[0] : undefined
  }

  // Two passes: every exact id first, so a weaker match can never steal a row
  // that a later entry would have claimed outright.
  const leftovers: SnapshotEntry[] = []
  for (const e of entries) {
    if (e.id != null && claim(e, byId.get(e.id))) continue
    leftovers.push(e)
  }
  for (const e of leftovers) {
    if (e.gd_id != null && e.name && claim(e, only(byGdName.get(`${e.gd_id}|${e.name.toLowerCase()}`)))) continue
    if (e.gd_id != null && claim(e, only(byGd.get(e.gd_id)))) continue
    if (e.name && claim(e, only(byName.get(e.name.toLowerCase())))) continue
    unmatched.push(e)
  }

  return { matched, unmatched, taken }
}

/**
 * Lay the list out the way a snapshot describes it.
 *
 * Set `apply` false to get the same report without writing anything — the admin
 * UI always previews first, because "restore 54,000 placements" is not a button
 * anyone should press blind.
 */
export function restoreSnapshot(
  db: DatabaseSync,
  entries: SnapshotEntry[],
  opts: { apply: boolean; sampleSize?: number } = { apply: false },
): RestoreResult {
  const levels = db.prepare(
    `SELECT id, position, sheet_placement, gd_id, name, gddl_tier FROM levels ORDER BY position ASC`,
  ).all() as LevelRow[]

  const { matched, unmatched, taken } = matchEntries(entries, levels)

  // Tiers the file disagrees with. A move rewrites the tier, so a file taken
  // before those moves carries the tiers they replaced — putting the level back
  // without its label would only half-undo the move.
  const tierFixes = matched
    .filter((m) => m.entry.gddl_tier && m.entry.gddl_tier !== m.level.gddl_tier)
    .map((m) => ({ id: m.level.id, tier: m.entry.gddl_tier! }))

  // The file's own ordering. `position` is what it usually carries; a
  // hand-edited file may repeat a number, so ties fall back to file order —
  // which makes "retype one level's position to 4200" land it beside the level
  // already at 4200 rather than anywhere unpredictable.
  const ordered = [...matched].sort((a, b) => {
    const ap = a.entry.position ?? a.entry.sheet_placement ?? Number.MAX_SAFE_INTEGER
    const bp = b.entry.position ?? b.entry.sheet_placement ?? Number.MAX_SAFE_INTEGER
    return ap - bp || a.entry.ordinal - b.entry.ordinal
  })

  // Levels the file never mentioned — added since it was taken, most likely.
  // Sweeping them to the bottom is the classic way to lose a level, so each one
  // is re-inserted directly after whichever mentioned level it currently
  // follows, keeping runs of them in their present order.
  const followers = new Map<number, LevelRow[]>()
  const leading: LevelRow[] = []
  let lastMentioned: number | null = null
  for (const l of levels) {
    if (taken.has(l.id)) { lastMentioned = l.id; continue }
    if (lastMentioned == null) { leading.push(l); continue }
    const b = followers.get(lastMentioned)
    if (b) b.push(l)
    else followers.set(lastMentioned, [l])
  }

  const finalOrder: LevelRow[] = [...leading]
  for (const m of ordered) {
    finalOrder.push(m.level)
    const extra = followers.get(m.level.id)
    if (extra) finalOrder.push(...extra)
  }

  // The placement numbers themselves are a multiset owned by the slots, not by
  // the levels — hand them back out in the new order so the list still counts
  // upwards. `resyncPlacements` does exactly this, so it runs after the write.
  const moves: RestoreMove[] = []
  finalOrder.forEach((l, i) => {
    const to = i + 1
    if (l.position !== to) {
      moves.push({
        level_id: l.id,
        name: l.name,
        gd_id: l.gd_id,
        from_position: l.position,
        to_position: to,
      })
    }
  })

  if (opts.apply && (moves.length || tierFixes.length)) {
    const setPos = db.prepare(`UPDATE levels SET position = ? WHERE id = ?`)
    const setTier = db.prepare(`UPDATE levels SET gddl_tier = ? WHERE id = ?`)
    db.exec('BEGIN')
    try {
      // Park everything at a unique negative position first: `position` is
      // UNIQUE, and any single-pass rewrite collides with a value another row
      // in the same batch still holds.
      if (moves.length) {
        finalOrder.forEach((l, i) => setPos.run(-(i + 1), l.id))
        finalOrder.forEach((l, i) => setPos.run(i + 1, l.id))
      }
      for (const f of tierFixes) setTier.run(f.tier, f.id)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    if (moves.length) resyncPlacements(db)
  }

  const sample = [...moves]
    .sort((a, b) => Math.abs(b.to_position - b.from_position) - Math.abs(a.to_position - a.from_position))
    .slice(0, opts.sampleSize ?? 25)

  return {
    matched: matched.length,
    unmatched: unmatched.length,
    untouched_extra: levels.length - matched.length,
    moved: moves.length,
    retiered: tierFixes.length,
    sample,
    applied: !!opts.apply && (moves.length > 0 || tierFixes.length > 0),
  }
}

/**
 * Put every sheet-backed level back into the sheet's own order.
 *
 * The same layout the importer produces, minus the download: rows carrying a
 * `sheet_rank` are renumbered into that order, and rows without one — the site's
 * own levels, which the sheet has no opinion about — hold the positions they
 * already occupy and the sheet-backed rows flow around them. Permanent levels
 * are anchored for the same reason the importer anchors them: they are
 * website-owned and never move with the sheet.
 *
 * Ordered by `sheet_rank`, not `sheet_placement`. The latter is redistributed
 * across slots on every move, so by the time anyone wants to undo those moves it
 * already agrees with the order it is supposed to be correcting — which made
 * this a no-op exactly when it was needed.
 */
export function resetToSheetOrder(
  db: DatabaseSync,
  opts: { apply: boolean; sampleSize?: number } = { apply: false },
): RestoreResult {
  const levels = db.prepare(
    `SELECT id, position, sheet_placement, sheet_rank, gd_id, name, gddl_tier,
            COALESCE(permanent, 0) AS permanent
       FROM levels
      ORDER BY position ASC`,
  ).all() as (LevelRow & { permanent: number; sheet_rank: number | null })[]

  const anchored = levels.filter((l) => l.sheet_rank == null || l.permanent === 1)
  const anchoredPositions = new Set(anchored.map((l) => l.position))
  const movable = levels
    .filter((l) => l.sheet_rank != null && l.permanent !== 1)
    .sort((a, b) => a.sheet_rank! - b.sheet_rank! || a.position - b.position)

  // The slots left over once the anchors have kept theirs, lowest first.
  const targets: number[] = []
  for (let p = 1; targets.length < movable.length; p++) {
    if (!anchoredPositions.has(p)) targets.push(p)
  }

  const moves: RestoreMove[] = []
  movable.forEach((l, i) => {
    const to = targets[i]!
    if (l.position !== to) {
      moves.push({
        level_id: l.id,
        name: l.name,
        gd_id: l.gd_id,
        from_position: l.position,
        to_position: to,
      })
    }
  })

  if (opts.apply && moves.length) {
    const setPos = db.prepare(`UPDATE levels SET position = ? WHERE id = ?`)
    db.exec('BEGIN')
    try {
      movable.forEach((l, i) => setPos.run(-(i + 1), l.id))
      movable.forEach((l, i) => setPos.run(targets[i]!, l.id))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    resyncPlacements(db)
  }

  const sample = [...moves]
    .sort((a, b) => Math.abs(b.to_position - b.from_position) - Math.abs(a.to_position - a.from_position))
    .slice(0, opts.sampleSize ?? 25)

  return {
    matched: movable.length,
    unmatched: 0,
    untouched_extra: anchored.length,
    moved: moves.length,
    // Tiers come from the sheet on the next import, which is where this order
    // came from too. Nothing to put back that the importer doesn't own.
    retiered: 0,
    sample,
    applied: !!opts.apply && moves.length > 0,
  }
}

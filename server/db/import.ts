import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, dataDir } from './index.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'
import { repairSandwichedTiers } from '../utils/tier-repair.ts'
import { afterListChange, parseSiteFields, tx } from '../utils/list-ops.ts'
import { recordRemoval } from '../utils/changes.ts'
import { buildSnapshot } from '../utils/placement-snapshot.ts'
// Relative, not `~`: this file also runs standalone under
// `node --experimental-strip-types`, where Nuxt's alias doesn't exist.
import { longestIncreasingRun } from '../../utils/lis.ts'
import {
  KNOWN_LEVEL_TABS, SHEET_BASE_URL, cell, cellHtml, discoverLevelTabs, extractLinkHref,
  fetchTabHtml, findHeaderRow, int, normDate, normTier, num, parseTable, parseTierLabel,
  resolveColumns, txt, type FieldSpec, type SheetTab,
} from './sheet-format.ts'

export { extractLinkHref, num, txt, parseTierLabel }

/**
 * The ALL sheet import.
 *
 * The sheet is the list's source of truth, with three kinds of site edit
 * layered on top that a refresh respects:
 * - a level staff moved (`pinned`) stays next to the level above it until the
 *   sheet moves that level itself;
 * - a field staff edited (`site_fields`) is not overwritten;
 * - a level staff removed (`level_tombstones`) is not added back.
 *
 * Levels the site added itself (`permanent`) keep their place relative to the
 * level above them. If the sheet later lists one, the sheet takes it over.
 *
 * Nothing is deleted on the first run that can't find it: a level missing from
 * the sheet is marked, and only removed if the next run can't find it either.
 */

/** Level tabs as `{ gid, label }`, for the maintenance scripts. */
export const TABS = KNOWN_LEVEL_TABS.map((t) => ({ gid: t.gid, label: t.name }))

const VOID_LIST_GID = '1630809094'
const PENDING_LIST_GID = '139895069'

// Sentinel pending_id for awaiting rows that came from the sheet's pending tab.
const SHEET_PENDING_ID = -1

/** The run is refused if the sheet yields fewer usable rows than this share of the sheet's levels here. */
const MIN_SHEET_FRACTION = 0.85
/** …or if it would delete more than this share of the list in one go. */
const MAX_PRUNE_FRACTION = 0.02
/** A level must be missing for at least this long (two refreshes) before it is removed. */
const MISSING_GRACE_HOURS = 3
/** Placement backups kept in `data/backups/`. */
const KEEP_IMPORT_SNAPSHOTS = 12

const allowShrinkEnv = () => process.env.LIST_IMPORT_ALLOW_SHRINK === '1'
const pruneNowEnv = () => process.env.LIST_IMPORT_PRUNE_NOW === '1'

const dupKey = (gd: number | null, n: string) => `${gd ?? ''}|${n.toLowerCase()}`

type Db = ReturnType<typeof getDb>

// ---------------------------------------------------------------- reading

type SheetRow = {
  tab: string
  placement: number
  name: string
  gdId: number | null
  tier: string | null
  difficulty: string | null
  challenge: boolean
  source: string | null
  skillset: string | null
  verifyDate: string | null
  verification: string | null
  verificationUrl: string | null
  /** Placement on verification. Only the top tab's is trusted. */
  pov: number | null
}

/** The sheet's level rows in list order, plus a line of log per tab. */
async function readSheet(db: Db, report?: ProgressReporter): Promise<SheetRow[]> {
  const tabs = await discoverLevelTabs()
  const knownGids = new Set(KNOWN_LEVEL_TABS.map((t) => t.gid))
  const nameByGd = db.prepare(`SELECT name FROM levels WHERE gd_id = ?`)

  report?.({ phase: 'Fetching the sheet', done: 0, total: tabs.length })
  const chunks: { tab: SheetTab; rows: SheetRow[] }[] = []

  for (const [tabIndex, tab] of tabs.entries()) {
    const label = `"${tab.name}" (gid ${tab.gid})`
    // A tab the site depends on must read cleanly; a newly discovered one is
    // allowed to be empty or half-built.
    const fail = (why: string) => {
      if (knownGids.has(tab.gid)) {
        throw new Error(`tab ${label}: ${why}. Nothing was changed. This is usually a transient Google response; run the import again.`)
      }
      console.warn(`[import] skipping tab ${label}: ${why}`)
    }

    const table = parseTable(await fetchTabHtml(tab.gid))
    if (!table) { fail('no table in the page'); report?.({ done: chunks.length }); continue }
    const headerIdx = findHeaderRow(table.text)
    if (headerIdx == null) { fail('no header row'); report?.({ done: chunks.length }); continue }
    const { cols, report: colReport } = resolveColumns(table, headerIdx)
    console.log(`[import] ${label}: ${colReport.filter((l) => !l.endsWith('not found')).join('; ')}`)
    if (cols.name == null) { fail('no level name column'); report?.({ done: chunks.length }); continue }
    if (cols.placement == null) { fail('no placement column'); report?.({ done: chunks.length }); continue }

    const rows: SheetRow[] = []
    for (let i = headerIdx + 1; i < table.text.length; i++) {
      const placement = int(cell(table, cols, i, 'placement'))
      if (placement == null) continue
      const gdId = int(cell(table, cols, i, 'gd_id'))
      let name = cell(table, cols, i, 'name')
      if (!name) {
        // Geometry Dash allows nameless levels and the curators place them.
        // Keep the row if it can be identified by its ID.
        if (gdId == null) continue
        const existing = nameByGd.all(gdId) as { name: string }[]
        if (existing.length > 1) continue
        name = existing[0]?.name ?? 'Unnamed'
      }
      const verHtml = cellHtml(table, cols, i, 'verification')
      rows.push({
        tab: tab.name,
        placement,
        name,
        gdId,
        tier: normTier(cell(table, cols, i, 'gddl_tier')),
        difficulty: cell(table, cols, i, 'difficulty'),
        challenge: (cell(table, cols, i, 'rated') ?? '').toLowerCase() === 'challenge',
        source: cell(table, cols, i, 'source'),
        skillset: cell(table, cols, i, 'main_skillset'),
        verifyDate: normDate(cell(table, cols, i, 'verify_date')),
        verification: cell(table, cols, i, 'verification'),
        verificationUrl: extractLinkHref(verHtml),
        pov: tabIndex === 0 ? int(cell(table, cols, i, 'pov')) : null,
      })
    }
    console.log(`[import] ${label}: ${rows.length} level rows${rows.length ? ` (#${rows[0]!.placement}–#${rows[rows.length - 1]!.placement})` : ''}`)
    if (!rows.length) fail('no level rows')
    else chunks.push({ tab, rows })
    report?.({ done: chunks.length })
  }

  // Tabs are read in the sheet's tab order; if the curators reorder the tabs,
  // the placements still say which block comes first.
  chunks.sort((a, b) => a.rows[0]!.placement - b.rows[0]!.placement)
  return chunks.flatMap((c) => c.rows)
}

// ---------------------------------------------------------------- matching

type LevelRow = {
  id: number
  gd_id: number | null
  name: string
  position: number
  permanent: number
  site_only: number
  pinned: number
  site_fields: string | null
  sheet_rank: number | null
  submitted_by: number | null
  source_tab: string | null
  sheet_missing_since: string | null
  gddl_tier: string | null
  difficulty: string | null
  placement_source: string | null
  main_skillset: string | null
  verify_date: string | null
  verification: string | null
  verification_url: string | null
  record_count: number
}

/** Sheet columns refreshed on existing levels, unless staff edited them here. */
const REFRESHED: { col: keyof LevelRow & string; from: (r: SheetRow) => string | null }[] = [
  { col: 'gddl_tier', from: (r) => r.tier },
  { col: 'difficulty', from: (r) => r.difficulty },
  { col: 'placement_source', from: (r) => r.source },
  { col: 'main_skillset', from: (r) => r.skillset },
  { col: 'verify_date', from: (r) => r.verifyDate },
  { col: 'verification', from: (r) => r.verification },
  { col: 'verification_url', from: (r) => r.verificationUrl },
]

function makeMatcher(levels: LevelRow[], sheetGdCounts: Map<number, number>) {
  const byKey = new Map<string, number>()
  const nameCounts = new Map<string, number>()
  const gdCounts = new Map<number, number>()
  const byId = new Map<number, LevelRow>()
  for (const l of levels) {
    byId.set(l.id, l)
    byKey.set(dupKey(l.gd_id, l.name), l.id)
    const n = l.name.toLowerCase()
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1)
    if (l.gd_id != null) gdCounts.set(l.gd_id, (gdCounts.get(l.gd_id) ?? 0) + 1)
  }
  const byName = new Map<string, number>()
  const byGd = new Map<number, number>()
  for (const l of levels) {
    if (nameCounts.get(l.name.toLowerCase()) === 1) byName.set(l.name.toLowerCase(), l.id)
    if (l.gd_id != null && gdCounts.get(l.gd_id) === 1) byGd.set(l.gd_id, l.id)
  }
  const claimed = new Set<number>()

  /**
   * Exact (ID, name) first. Then a unique name, but never across two different
   * IDs — names collide constantly and "Blight" ≠ "blight (ID 2)". Then a unique
   * ID, but only when the sheet lists that ID once (Solo/2P pairs share one).
   */
  function match(gdId: number | null, name: string): number | undefined {
    const take = (id: number | undefined) => {
      if (id === undefined || claimed.has(id)) return undefined
      claimed.add(id)
      return id
    }
    const exact = take(byKey.get(dupKey(gdId, name)))
    if (exact !== undefined) return exact
    const n = byName.get(name.toLowerCase())
    if (n !== undefined) {
      const cand = byId.get(n)!
      if (!(cand.gd_id != null && gdId != null && cand.gd_id !== gdId)) {
        const got = take(n)
        if (got !== undefined) return got
      }
    }
    if (gdId != null && (sheetGdCounts.get(gdId) ?? 0) === 1) return take(byGd.get(gdId))
    return undefined
  }
  return { match, claimed }
}

// ---------------------------------------------------------------- the import

async function importLevels(report?: ProgressReporter): Promise<void> {
  const db = getDb()
  const allowShrink = allowShrinkEnv()

  cleanupDuplicateLevels(db)

  const sheet = await readSheet(db, report)

  const levels = db.prepare(
    `SELECT l.id, l.gd_id, l.name, l.position, COALESCE(l.permanent, 0) AS permanent,
            COALESCE(l.site_only, 0) AS site_only, COALESCE(l.pinned, 0) AS pinned, l.site_fields,
            l.sheet_rank, l.submitted_by, l.source_tab, l.sheet_missing_since,
            l.gddl_tier, l.difficulty, l.placement_source, l.main_skillset, l.verify_date,
            l.verification, l.verification_url,
            (SELECT COUNT(*) FROM records r WHERE r.level_id = l.id) AS record_count
       FROM levels l ORDER BY l.position`,
  ).all() as LevelRow[]

  // The sheet's levels here, as opposed to the site's own additions.
  const sheetBacked = levels.filter((l) => !l.permanent && !l.site_only).length
  if (sheetBacked > 0 && sheet.length < sheetBacked * MIN_SHEET_FRACTION && !allowShrink) {
    throw new Error(
      `the sheet yielded ${sheet.length} level rows but ${sheetBacked} levels here come from it. ` +
      `Refusing to import, nothing was changed. If the sheet really shrank that much, set LIST_IMPORT_ALLOW_SHRINK=1 for one run.`,
    )
  }

  snapshotBeforeImport(db)

  const sheetGdCounts = new Map<number, number>()
  const sheetGdIds = new Set<number>()
  const sheetNames = new Set<string>()
  for (const r of sheet) {
    if (r.gdId != null) {
      sheetGdCounts.set(r.gdId, (sheetGdCounts.get(r.gdId) ?? 0) + 1)
      sheetGdIds.add(r.gdId)
    }
    sheetNames.add(r.name.toLowerCase())
  }

  const tombstones = db.prepare(`SELECT id, gd_id, name FROM level_tombstones`).all() as { id: number; gd_id: number | null; name: string }[]
  const tombByGd = new Map(tombstones.filter((t) => t.gd_id != null).map((t) => [t.gd_id!, t.id]))
  const tombByName = new Map(tombstones.filter((t) => t.gd_id == null).map((t) => [t.name.toLowerCase(), t.id]))
  const tombstonesStillListed = new Set<number>()

  const { match, claimed } = makeMatcher(levels, sheetGdCounts)
  const byId = new Map(levels.map((l) => [l.id, l]))

  // Where the sheet puts each level this run (its own number), and the order
  // the sheet rows came in.
  const sheetRankById = new Map<number, number>()
  const sheetIndexById = new Map<number, number>()
  const sheetExclusives: SheetExclusiveRow[] = []
  const seenKeys = new Set<string>()
  const updates: { id: number; row: SheetRow }[] = []
  const inserts: { row: SheetRow; index: number }[] = []
  const challengeIds = new Set<number>()

  sheet.forEach((row, index) => {
    const key = dupKey(row.gdId, row.name)
    if (seenKeys.has(key)) return // listed twice, e.g. at the seam between two tabs
    seenKeys.add(key)

    const tomb = row.gdId != null ? tombByGd.get(row.gdId) : tombByName.get(row.name.toLowerCase())
    if (tomb !== undefined) {
      tombstonesStillListed.add(tomb)
      sheetExclusives.push(exclusiveFrom(row, 'removed on the site'))
      return
    }

    const id = match(row.gdId, row.name)
    if (id !== undefined) {
      updates.push({ id, row })
      sheetRankById.set(id, row.placement)
      sheetIndexById.set(id, index)
    } else {
      inserts.push({ row, index })
    }
  })

  // ---- write the sheet's data
  report?.({ phase: 'Updating levels', done: 0, total: null })
  const hadLevelsBefore = levels.length > 0
  const newIds = new Set<number>()
  let refreshed = 0
  let handedOver = 0

  tx(db, () => {
    const insert = db.prepare(`
      INSERT INTO levels
        (position, name, gd_id, gddl_tier, difficulty, placement_source, main_skillset,
         verify_date, verification, verification_url, pov_placement, category, source_tab,
         rated, sheet_placement, sheet_rank)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', ?, ?, ?, ?)`)
    let tempPos = levels.reduce((m, l) => Math.max(m, l.position), 0)

    for (const { id, row } of updates) {
      const lvl = byId.get(id)!
      const site = parseSiteFields(lvl.site_fields)
      const sets: string[] = []
      const vals: (string | number | null)[] = []
      const set = (col: string, v: string | number | null) => { sets.push(`${col} = ?`); vals.push(v) }

      if (lvl.permanent) {
        // A level the site added, now on the sheet: the sheet takes it over.
        // Whatever the site says differently is kept as a site edit.
        // The tier is left out: placement goes back to the sheet, and the tier
        // belongs to the placement.
        for (const f of REFRESHED) {
          if (f.col === 'gddl_tier') continue
          const mine = lvl[f.col] as string | null
          const theirs = f.from(row)
          if (mine && theirs && mine !== theirs) site.add(f.col)
        }
        site.delete('gddl_tier')
        if (row.name.toLowerCase() !== lvl.name.toLowerCase()) site.add('name')
        set('permanent', 0)
        set('site_fields', site.size ? JSON.stringify([...site].sort()) : null)
        handedOver++
      }

      if (!site.has('name') && row.name !== lvl.name) set('name', row.name)
      if (!site.has('gd_id') && row.gdId != null && row.gdId !== lvl.gd_id) set('gd_id', row.gdId)
      let changedField = false
      for (const f of REFRESHED) {
        const v = f.from(row)
        if (v == null || site.has(f.col) || lvl[f.col] === v) continue
        set(f.col, v)
        changedField = true
      }
      if (changedField) refreshed++
      set('sheet_rank', row.placement)
      set('source_tab', row.tab)
      if (lvl.sheet_missing_since) set('sheet_missing_since', null)
      vals.push(id)
      db.prepare(`UPDATE levels SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
      if (row.challenge) challengeIds.add(id)
    }

    for (const { row, index } of inserts) {
      tempPos++
      const res = insert.run(
        tempPos, row.name, row.gdId, row.tier, row.difficulty, row.source, row.skillset,
        row.verifyDate, row.verification, row.verificationUrl, row.pov,
        row.tab, row.challenge ? 'Challenge' : null, tempPos, row.placement,
      )
      const id = Number(res.lastInsertRowid)
      newIds.add(id)
      sheetRankById.set(id, row.placement)
      sheetIndexById.set(id, index)
      if (row.challenge) challengeIds.add(id)
    }
  })

  // ---- levels the sheet no longer lists
  const unmatched = levels.filter((l) => !claimed.has(l.id))
  const now = Date.now()
  const graceMs = pruneNowEnv() ? 0 : MISSING_GRACE_HOURS * 3600_000
  const toPrune: LevelRow[] = []
  const missingNow: LevelRow[] = []
  const anchors = new Set<number>()
  for (const l of unmatched) {
    // Only a level the sheet put here can be taken away by the sheet. Anything
    // a person added, or that carries records, stays.
    const sheetBorn = !l.permanent && !l.submitted_by && l.source_tab !== 'ALL Submission' && l.record_count === 0
    if (!sheetBorn) { anchors.add(l.id); continue }
    const since = l.sheet_missing_since ? Date.parse(`${l.sheet_missing_since.replace(' ', 'T')}Z`) : NaN
    if (Number.isFinite(since) && now - since >= graceMs) toPrune.push(l)
    else { missingNow.push(l); anchors.add(l.id) }
  }

  if (toPrune.length > Math.max(50, levels.length * MAX_PRUNE_FRACTION) && !allowShrink) {
    throw new Error(
      `the import would remove ${toPrune.length} of ${levels.length} levels. Refusing; nothing was removed. ` +
      `If that is really intended, set LIST_IMPORT_ALLOW_SHRINK=1 for one run.`,
    )
  }

  tx(db, () => {
    const markMissing = db.prepare(`UPDATE levels SET sheet_missing_since = datetime('now') WHERE id = ? AND sheet_missing_since IS NULL`)
    for (const l of missingNow) markMissing.run(l.id)
    const clearRank = db.prepare(`UPDATE levels SET sheet_rank = NULL WHERE id = ?`)
    for (const id of anchors) clearRank.run(id)
    const del = db.prepare(`DELETE FROM levels WHERE id = ?`)
    for (const l of toPrune) {
      recordRemoval(db, l.id, null, 'Removed from the sheet')
      del.run(l.id)
    }
    // The sheet dropped the rows these were holding back.
    const dropTomb = db.prepare(`DELETE FROM level_tombstones WHERE id = ?`)
    for (const t of tombstones) if (!tombstonesStillListed.has(t.id)) dropTomb.run(t.id)
  })

  if (missingNow.length) {
    console.log(`[import] ${missingNow.length} level(s) not on the sheet this run; removed next run if still missing:`)
    for (const l of missingNow.slice(0, 15)) console.log(`  · ${l.name}${l.gd_id ? ` (${l.gd_id})` : ''}`)
  }
  if (toPrune.length) {
    console.log(`[import] removed ${toPrune.length} level(s) the sheet no longer lists:`)
    for (const l of toPrune.slice(0, 15)) console.log(`  · ${l.name}${l.gd_id ? ` (${l.gd_id})` : ''}`)
  }

  const siteOnly = markSiteOnly(db, sheetGdIds, sheetNames)
  recordSheetExclusives(db, sheetExclusives)

  // ---- order
  report?.({ phase: 'Ordering', done: 0, total: null })
  const pins = settlePins(db, levels, sheetRankById, anchors)
  const satisfied = applySheetOrder(db, sheetIndexById, { anchors, newIds, recordHistory: hadLevelsBefore })
  applyChallengeFromSheet(db, challengeIds)

  const tierFixes = repairSandwichedTiers(db)
  for (const f of tierFixes.slice(0, 20)) console.log(`  tier fix: #${f.position} ${f.name}: ${f.from} → ${f.to}`)

  report?.({ phase: 'Recomputing points', done: 0, total: null })
  afterListChange(db)

  console.log(
    `[import] ${sheet.length} sheet rows: ${updates.length} matched (${refreshed} with new data), ${newIds.size} new, ` +
    `${handedOver} handed to the sheet, ${toPrune.length} removed, ${missingNow.length} missing once, ` +
    `${sheetExclusives.length} skipped. Pins: ${pins.kept} kept, ${pins.released + satisfied} released. ` +
    `${siteOnly.siteOnly} site-only. ${tierFixes.length} tier fix(es).`,
  )
}

/**
 * Release pins the sheet has overruled.
 *
 * A pin holds until the curators move that level themselves. "Moved" means
 * moved relative to the other levels — everything outside the longest run of
 * levels the old and new sheet orders agree on — so a level merely shifted by
 * insertions above it keeps its pin.
 */
function settlePins(db: Db, levels: LevelRow[], sheetRankById: Map<number, number>, anchors: Set<number>): { kept: number; released: number } {
  const pinned = levels.filter((l) => l.pinned)
  if (!pinned.length) return { kept: 0, released: 0 }

  const oldRank = new Map<number, number>()
  const newRank = new Map<number, number>()
  for (const l of levels) {
    const now = sheetRankById.get(l.id)
    if (l.sheet_rank != null && now != null) {
      oldRank.set(l.id, l.sheet_rank)
      newRank.set(l.id, now)
    }
  }
  const movedBySheet = new Set(survivorsThatMoved(oldRank, newRank))

  let released = 0
  let kept = 0
  tx(db, () => {
    for (const l of pinned) {
      if (!sheetRankById.has(l.id)) { anchors.add(l.id); kept++; continue }
      if (movedBySheet.has(l.id)) {
        releasePin(db, l.id)
        released++
      } else {
        anchors.add(l.id)
        kept++
      }
    }
  })
  return { kept, released }
}

function releasePin(db: Db, id: number): void {
  const row = db.prepare(`SELECT site_fields FROM levels WHERE id = ?`).get(id) as { site_fields: string | null }
  const site = parseSiteFields(row.site_fields)
  site.delete('gddl_tier') // the tier came with the slot, and the slot is the sheet's again
  db.prepare(`UPDATE levels SET pinned = 0, pinned_at = NULL, site_fields = ? WHERE id = ?`)
    .run(site.size ? JSON.stringify([...site].sort()) : null, id)
}

/**
 * Renumber the list: sheet levels in the sheet's order, and every anchored
 * level (pinned, site-added, missing this run) directly after whichever sheet
 * level it followed before. Positions come out 1..N with no gaps.
 *
 * Returns how many pins turned out to agree with the sheet and were released.
 */
function applySheetOrder(
  db: Db,
  sheetIndexById: Map<number, number>,
  opts: { anchors: Set<number>; newIds: Set<number>; recordHistory: boolean },
): number {
  const all = db.prepare(`SELECT id, position, pinned FROM levels ORDER BY position ASC`).all() as { id: number; position: number; pinned: number }[]
  const oldPositions = new Map(all.map((r) => [r.id, r.position]))

  const followers = new Map<number | 'top', number[]>()
  let prev: number | 'top' = 'top'
  for (const r of all) {
    if (opts.anchors.has(r.id)) {
      const list = followers.get(prev) ?? []
      list.push(r.id)
      followers.set(prev, list)
    } else {
      prev = r.id
    }
  }

  const ranked = all
    .filter((r) => !opts.anchors.has(r.id))
    .map((r) => ({ id: r.id, rank: sheetIndexById.get(r.id) ?? Number.POSITIVE_INFINITY, pos: r.position }))
    .sort((a, b) => a.rank - b.rank || a.pos - b.pos)

  const order: number[] = [...(followers.get('top') ?? [])]
  for (const r of ranked) {
    order.push(r.id)
    for (const f of followers.get(r.id) ?? []) order.push(f)
  }

  const setPos = db.prepare(`UPDATE levels SET position = ? WHERE id = ?`)
  tx(db, () => {
    order.forEach((id, i) => setPos.run(-(i + 1), id))
    order.forEach((id, i) => setPos.run(i + 1, id))
  })

  // A pin the sheet now agrees with — the level would land in the same spot
  // without it — has done its job.
  const pinnedIds = all.filter((r) => r.pinned && opts.anchors.has(r.id) && sheetIndexById.has(r.id)).map((r) => r.id)
  let satisfied = 0
  if (pinnedIds.length) {
    const rankedIdx = ranked.map((r) => r.rank)
    const indexInOrder = new Map(order.map((id, i) => [id, i]))
    tx(db, () => {
      for (const id of pinnedIds) {
        const myRank = sheetIndexById.get(id)!
        // The last sheet level the sheet puts before this one.
        let lo = 0
        let hi = rankedIdx.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (rankedIdx[mid]! < myRank) lo = mid + 1
          else hi = mid
        }
        const sheetPrev = lo > 0 ? ranked[lo - 1]!.id : null
        const at = indexInOrder.get(id)!
        const actualPrev = at > 0 ? order[at - 1]! : null
        if (sheetPrev === actualPrev) {
          releasePin(db, id)
          satisfied++
        }
      }
    })
  }

  if (opts.recordHistory) {
    recordSheetMovements(db, {
      oldPositions,
      newPositions: new Map(order.map((id, i) => [id, i + 1])),
      newIds: opts.newIds,
    })
  }
  return satisfied
}

/**
 * Which levels moved relative to each other: everything outside the longest
 * increasing run of the new order read in the old order. One promotion from
 * #500 to #100 is one entry, not one up and four hundred down.
 */
export function survivorsThatMoved(
  oldPositions: Map<number, number>,
  newPositions: Map<number, number>,
  newIds: Set<number> = new Set(),
): number[] {
  const survivors = [...newPositions.keys()].filter((id) => !newIds.has(id) && oldPositions.has(id))
  const byOldOrder = survivors.slice().sort((a, b) => oldPositions.get(a)! - oldPositions.get(b)!)
  const newRank = new Map<number, number>()
  survivors.slice()
    .sort((a, b) => newPositions.get(a)! - newPositions.get(b)!)
    .forEach((id, i) => newRank.set(id, i))
  const backbone = new Set(longestIncreasingRun(byOldOrder.map((id) => newRank.get(id)!)))
  return byOldOrder.filter((id, i) => !backbone.has(i) && oldPositions.get(id) !== newPositions.get(id))
}

function recordSheetMovements(
  db: Db,
  args: { oldPositions: Map<number, number>; newPositions: Map<number, number>; newIds: Set<number> },
): void {
  const { oldPositions, newPositions, newIds } = args
  const ins = db.prepare(
    `INSERT INTO position_history (level_id, from_position, to_position, changed_by, source)
     VALUES (?, ?, ?, NULL, 'all')`,
  )
  let moves = 0
  let adds = 0
  tx(db, () => {
    for (const id of survivorsThatMoved(oldPositions, newPositions, newIds)) {
      ins.run(id, oldPositions.get(id)!, newPositions.get(id)!)
      moves++
    }
    for (const id of newIds) {
      const pos = newPositions.get(id)
      if (pos == null) continue
      ins.run(id, null, pos)
      adds++
    }
  })
  console.log(`[import] changelog: ${adds} added, ${moves} moved`)
}

/**
 * `rated = 'Challenge'` follows the sheet's Rated column for sheet levels.
 * Other ratings come from Geometry Dash and are never written here.
 */
function applyChallengeFromSheet(db: Db, challengeIds: Set<number>): void {
  const rows = db.prepare(
    `SELECT id, rated FROM levels WHERE COALESCE(permanent, 0) = 0 AND COALESCE(site_only, 0) = 0`,
  ).all() as { id: number; rated: string | null }[]
  const upd = db.prepare(`UPDATE levels SET rated = ? WHERE id = ?`)
  let changed = 0
  tx(db, () => {
    for (const r of rows) {
      const want = challengeIds.has(r.id)
      if (want && r.rated !== 'Challenge') { upd.run('Challenge', r.id); changed++ }
      else if (!want && r.rated === 'Challenge') { upd.run(null, r.id); changed++ }
    }
  })
  if (changed) console.log(`[import] challenge pins: ${changed} updated`)
}

/** Placements as they were before this import, in `data/backups/`. Keeps the newest few. */
function snapshotBeforeImport(db: Db): void {
  try {
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM levels`).get() as { n: number }).n
    if (!count) return
    const dir = join(dataDir(), 'backups')
    mkdirSync(dir, { recursive: true })
    const prefix = 'placements-before-import-'
    writeFileSync(join(dir, `${prefix}${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(buildSnapshot(db)))
    const old = readdirSync(dir).filter((f) => f.startsWith(prefix)).sort()
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_IMPORT_SNAPSHOTS))) unlinkSync(join(dir, f))
  } catch (e) {
    console.warn('[import] could not write the pre-import placement backup:', (e as Error).message)
  }
}

// ---------------------------------------------------------------- housekeeping

/**
 * Collapse rows left behind by very old imports that duplicated the list. Keeps
 * the permanent row, else the oldest, and repoints what referenced the rest.
 * A no-op on a clean database.
 */
function cleanupDuplicateLevels(db: Db): void {
  const rows = db.prepare(`SELECT id, gd_id, name, permanent FROM levels`).all() as
    { id: number; gd_id: number | null; name: string; permanent: number }[]
  const groups = new Map<string, { id: number; perm: boolean }[]>()
  for (const r of rows) {
    const key = dupKey(r.gd_id, r.name)
    const g = groups.get(key) ?? []
    g.push({ id: r.id, perm: r.permanent === 1 })
    groups.set(key, g)
  }
  const remap: { drop: number; keep: number }[] = []
  for (const g of groups.values()) {
    if (g.length < 2) continue
    g.sort((a, b) => Number(b.perm) - Number(a.perm) || a.id - b.id)
    for (let i = 1; i < g.length; i++) remap.push({ drop: g[i]!.id, keep: g[0]!.id })
  }
  if (!remap.length) return

  tx(db, () => {
    const updRecords = db.prepare(`UPDATE records SET level_id = ? WHERE level_id = ?`)
    const updOpinions = db.prepare(`UPDATE opinions SET level_id = ? WHERE list_kind = 'main' AND level_id = ?`)
    const updPending = db.prepare(`UPDATE pending_levels SET comparison_level_id = ? WHERE comparison_level_id = ?`)
    const del = db.prepare(`DELETE FROM levels WHERE id = ?`)
    for (const { drop, keep } of remap) {
      updRecords.run(keep, drop)
      updOpinions.run(keep, drop)
      updPending.run(keep, drop)
      del.run(drop)
    }
  })
  console.log(`[import] merged ${remap.length} duplicate level row(s)`)
}

/**
 * `site_only` = the sheet lists nothing with this level's ID (or, for a level
 * with no ID, its name). Recomputed from the whole sheet every run.
 */
export function markSiteOnly(db: Db, sheetGdIds: Set<number>, sheetNames: Set<string>): { siteOnly: number; changed: number } {
  const rows = db.prepare(`SELECT id, gd_id, name, site_only FROM levels`).all() as
    { id: number; gd_id: number | null; name: string; site_only: number }[]
  const upd = db.prepare(`UPDATE levels SET site_only = ? WHERE id = ?`)
  let siteOnly = 0
  let changed = 0
  tx(db, () => {
    for (const r of rows) {
      const onSheet = r.gd_id != null ? sheetGdIds.has(r.gd_id) : sheetNames.has(r.name.toLowerCase())
      const want = onSheet ? 0 : 1
      if (want) siteOnly++
      if (r.site_only !== want) { upd.run(want, r.id); changed++ }
    }
  })
  return { siteOnly, changed }
}

type SheetExclusiveRow = {
  gd_id: number | null
  name: string
  sheet_placement: number | null
  gddl_tier: string | null
  difficulty: string | null
  verify_date: string | null
  verification_url: string | null
  source_tab: string | null
  placement_source: string | null
  reason: string
}

function exclusiveFrom(row: SheetRow, reason: string): SheetExclusiveRow {
  return {
    gd_id: row.gdId, name: row.name, sheet_placement: row.placement, gddl_tier: row.tier,
    difficulty: row.difficulty, verify_date: row.verifyDate, verification_url: row.verificationUrl,
    source_tab: row.tab, placement_source: row.source, reason,
  }
}

/** Sheet rows the import read but didn't put on the list, replaced every run. */
function recordSheetExclusives(db: Db, rows: SheetExclusiveRow[]): void {
  tx(db, () => {
    db.exec(`DELETE FROM sheet_exclusive_levels`)
    const ins = db.prepare(
      `INSERT INTO sheet_exclusive_levels
         (gd_id, name, sheet_placement, gddl_tier, difficulty, verifier, verify_date,
          verification_url, source_tab, placement_source, reason)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    for (const r of rows) {
      ins.run(r.gd_id, r.name, r.sheet_placement, r.gddl_tier, r.difficulty, r.verify_date,
        r.verification_url, r.source_tab, r.placement_source, r.reason)
    }
  })
}

// ---------------------------------------------------------------- void list

const VOID_FIELDS: FieldSpec[] = [
  { key: 'name', titles: ['levelname', 'level', 'name'], not: /id$/ },
  { key: 'gd_id', titles: ['levelid', 'id', 'gdid'], shape: (t) => int(t) != null, drift: [1, -1] },
  { key: 'verify_date', titles: ['verifydate', 'verificationdate', 'dateverified'], drift: [1, -1] },
  { key: 'days', titles: ['days', 'dayssinceverification', 'daysvoid'], shape: (t) => num(t) != null },
  { key: 'demon_ranking', titles: ['demonranking', 'difficulty', 'demondifficulty'], drift: [1, -1] },
  { key: 'source', titles: ['source', 'primarysource', 'placementsource'], drift: [1, -1] },
  { key: 'verification', titles: ['verificationlink', 'verification', 'video'], shape: (_t, h) => /<a[^>]*\shref=/i.test(h), drift: [1, 2, -1] },
  { key: 'added_on', titles: ['addedtopendingon', 'addedon', 'added', 'dateadded'], drift: [1, -1] },
]

/**
 * The sheet's void list. Rows are matched to existing ones by (ID, name) so
 * their ids — which opinions and submissions point at — survive a refresh.
 */
export async function importVoidList(): Promise<void> {
  const db = getDb()
  const table = parseTable(await fetchTabHtml(VOID_LIST_GID))
  if (!table) { console.log('[void] no table, skipping'); return }
  const headerIdx = findHeaderRow(table.text, VOID_FIELDS)
  if (headerIdx == null) { console.log('[void] no header row, skipping'); return }
  const { cols } = resolveColumns(table, headerIdx, VOID_FIELDS)
  if (cols.name == null) { console.log('[void] no level name column, skipping'); return }

  type VoidRow = { name: string; gdId: number | null; verifyDate: string | null; days: number | null; ranking: string | null; source: string | null; verification: string | null; url: string | null; addedOn: string | null }
  const rows: VoidRow[] = []
  for (let i = headerIdx + 1; i < table.text.length; i++) {
    const name = cell(table, cols, i, 'name')
    if (!name) continue
    const gdId = int(cell(table, cols, i, 'gd_id'))
    const verifyDate = normDate(cell(table, cols, i, 'verify_date'))
    const days = num(cell(table, cols, i, 'days'))
    const ranking = cell(table, cols, i, 'demon_ranking')
    const source = cell(table, cols, i, 'source')
    if (gdId == null && !verifyDate && days == null && !ranking && !source) continue // section header
    let addedOn = normDate(cell(table, cols, i, 'added_on'))
    if (!addedOn && days != null) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - Math.max(0, Math.round(days)))
      addedOn = d.toISOString().slice(0, 10)
    }
    rows.push({
      name, gdId, verifyDate, days, ranking, source,
      verification: cell(table, cols, i, 'verification'),
      url: extractLinkHref(cellHtml(table, cols, i, 'verification')),
      addedOn,
    })
  }

  const existing = db.prepare(`SELECT id, gd_id, name FROM void_levels`).all() as { id: number; gd_id: number | null; name: string }[]
  if (existing.length > 10 && rows.length < existing.length * 0.5) {
    console.warn(`[void] sheet yielded ${rows.length} rows against ${existing.length} here; not updating`)
    return
  }
  const byKey = new Map(existing.map((r) => [dupKey(r.gd_id, r.name), r.id]))

  tx(db, () => {
    // Park every position so the renumbering below can't collide.
    db.exec(`UPDATE void_levels SET position = -id`)
    const upd = db.prepare(
      `UPDATE void_levels SET position = ?, name = ?, gd_id = ?, verify_date = ?, days = ?, demon_ranking = ?,
              placement_source = ?, verification = ?, verification_url = COALESCE(?, verification_url), added_on = COALESCE(?, added_on)
        WHERE id = ?`,
    )
    const ins = db.prepare(
      `INSERT INTO void_levels (position, name, gd_id, verify_date, days, demon_ranking, placement_source, verification, verification_url, added_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const kept = new Set<number>()
    let pos = 0
    for (const r of rows) {
      const key = dupKey(r.gdId, r.name)
      const id = byKey.get(key)
      if (id !== undefined && kept.has(id)) continue
      pos++
      if (id !== undefined) {
        kept.add(id)
        upd.run(pos, r.name, r.gdId, r.verifyDate, r.days, r.ranking, r.source, r.verification, r.url, r.addedOn, id)
      } else {
        const res = ins.run(pos, r.name, r.gdId, r.verifyDate, r.days, r.ranking, r.source, r.verification, r.url, r.addedOn)
        kept.add(Number(res.lastInsertRowid))
      }
    }
    const del = db.prepare(`DELETE FROM void_levels WHERE id = ?`)
    for (const r of existing) if (!kept.has(r.id)) del.run(r.id)
  })
  console.log(`[void] ${rows.length} levels`)
}

// ---------------------------------------------------------------- pending list

const PENDING_FIELDS: FieldSpec[] = [
  { key: 'name', titles: ['levelname', 'level', 'name'], not: /id$/ },
  { key: 'gd_id', titles: ['levelid', 'id', 'gdid'], shape: (t) => int(t) != null, drift: [1, -1] },
  { key: 'verify_date', titles: ['verifydate', 'verificationdate', 'dateverified'], drift: [1, -1] },
  { key: 'approx', titles: ['difficultyapproximation', 'approximation', 'generalidea', 'opinion', 'notes'], contains: ['approx'] },
  { key: 'range', titles: ['range', 'generalidearange', 'placementrange', 'estimate', 'estimatedplacement'], contains: ['range'], shape: (t) => /\d/.test(t) },
  { key: 'gddl_tier', titles: ['gddltier', 'tier', 'gddl'], shape: (t) => parseTierLabel(t) != null, drift: [1, -1] },
  { key: 'demon_ranking', titles: ['demonranking', 'difficulty', 'demondifficulty'], not: /approx/, drift: [1, -1] },
  { key: 'source', titles: ['source', 'primarysource', 'placementsource'], drift: [1, -1] },
  { key: 'verification', titles: ['verificationlink', 'verification', 'video'], shape: (_t, h) => /<a[^>]*\shref=/i.test(h), drift: [1, 2, -1] },
  { key: 'added_on', titles: ['addedtopendingon', 'addedon', 'added', 'dateadded'], drift: [1, -1] },
]

/**
 * The sheet's pending tab, as review items in the admin queue. Rows already
 * pending, awaiting or on the list are skipped; rows the sheet dropped are
 * removed from the queue.
 */
export async function importPendingList(report?: ProgressReporter): Promise<void> {
  const db = getDb()
  report?.({ phase: 'Fetching the pending tab', done: 0, total: null })
  const table = parseTable(await fetchTabHtml(PENDING_LIST_GID))
  if (!table) { console.log('[pending] no table, skipping'); return }
  const headerIdx = findHeaderRow(table.text, PENDING_FIELDS)
  if (headerIdx == null) { console.log('[pending] no header row, skipping'); return }
  const { cols } = resolveColumns(table, headerIdx, PENDING_FIELDS)
  if (cols.name == null) { console.log('[pending] no level name column, skipping'); return }

  const existingKeys = new Set<string>([
    ...(db.prepare(`SELECT gd_id, name FROM pending_levels WHERE status = 'pending'`).all() as { gd_id: number | null; name: string }[])
      .map((r) => dupKey(r.gd_id, r.name ?? '')),
    ...(db.prepare(`SELECT gd_id, name FROM awaiting_levels`).all() as { gd_id: number | null; name: string }[])
      .map((r) => dupKey(r.gd_id, r.name)),
  ])
  const existingSheetRows = db.prepare(
    `SELECT id, gd_id, name FROM pending_levels WHERE from_sheet_pending = 1 AND status = 'pending'`,
  ).all() as { id: number; gd_id: number | null; name: string }[]
  const mainGdIds = new Set((db.prepare(`SELECT gd_id FROM levels WHERE gd_id IS NOT NULL`).all() as { gd_id: number }[]).map((r) => r.gd_id))
  const usedVideos = new Set((db.prepare(
    `SELECT verification_url FROM levels WHERE verification_url IS NOT NULL AND verification_url <> ''`,
  ).all() as { verification_url: string }[]).map((r) => r.verification_url))

  const tierPositions = new Map<string, number[]>()
  const positionForTier = (tier: string, frac: number): number | null => {
    let positions = tierPositions.get(tier)
    if (!positions) {
      positions = (db.prepare(`SELECT position FROM levels WHERE gddl_tier = ? ORDER BY position ASC`).all(tier) as { position: number }[]).map((r) => r.position)
      tierPositions.set(tier, positions)
    }
    if (!positions.length) return null
    return positions[Math.min(positions.length - 1, Math.floor(frac * positions.length))]!
  }

  const insert = db.prepare(`
    INSERT INTO pending_levels
      (gd_id, name, verify_date, gddl_tier, difficulty, verification, verification_url, placement_source,
       placement_estimate, notes, status, submitted_at, from_sheet_pending)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1)`)

  const seen = new Set<string>()
  let imported = 0
  let removed = 0
  tx(db, () => {
    db.prepare(`DELETE FROM awaiting_levels WHERE pending_id = ?`).run(SHEET_PENDING_ID)
    for (let i = headerIdx + 1; i < table.text.length; i++) {
      const name = cell(table, cols, i, 'name')
      if (!name) continue
      const gdId = int(cell(table, cols, i, 'gd_id'))
      const verifyDate = normDate(cell(table, cols, i, 'verify_date'))
      const rawTier = cell(table, cols, i, 'gddl_tier')
      const range = cell(table, cols, i, 'range')
      if (gdId == null && !verifyDate && !rawTier && !range) continue // section header
      if (gdId != null && mainGdIds.has(gdId)) continue
      const key = dupKey(gdId, name)
      if (seen.has(key)) continue
      seen.add(key)
      if (existingKeys.has(key)) continue
      const url = extractLinkHref(cellHtml(table, cols, i, 'verification'))
      if (url && usedVideos.has(url)) continue

      const parsedTier = parseTierLabel(rawTier)
      const rangeNum = range?.match(/(\d[\d,]*)/)
      const estimate = rangeNum ? num(rangeNum[1]!) : (parsedTier ? positionForTier(parsedTier.tier, parsedTier.frac) : null)
      insert.run(
        gdId, name, verifyDate, parsedTier?.tier ?? rawTier, cell(table, cols, i, 'demon_ranking'),
        cell(table, cols, i, 'verification'), url, cell(table, cols, i, 'source'),
        estimate, cell(table, cols, i, 'approx'),
        normDate(cell(table, cols, i, 'added_on')) ?? new Date().toISOString().slice(0, 10),
      )
      imported++
    }
    const del = db.prepare(`DELETE FROM pending_levels WHERE id = ?`)
    for (const r of existingSheetRows) {
      if (!seen.has(dupKey(r.gd_id, r.name ?? ''))) { del.run(r.id); removed++ }
    }
  })
  console.log(`[pending] ${imported} new, ${removed} removed`)
}

// ---------------------------------------------------------------- entry point

let running: Promise<void> | null = null

/**
 * Import the sheet. Only one runs at a time: a second caller (the scheduled
 * refresh firing while an admin's import is going) joins the one in progress.
 */
export function runImport(report?: ProgressReporter): Promise<void> {
  if (running) {
    console.log('[import] already running; waiting for it instead of starting another')
    return running
  }
  running = (async () => {
    const t0 = Date.now()
    try {
      await importLevels(report)
      const failures: string[] = []
      const stage = async (phase: string, run: () => Promise<unknown>) => {
        report?.({ phase, done: 0, total: null })
        try {
          await run()
        } catch (err) {
          failures.push(phase)
          console.error(`[import] ${phase} failed, continuing:`, (err as Error).message)
        }
      }
      await stage('Void list', importVoidList)
      await stage('Pending list', () => importPendingList(report))
      console.log(`[import] done in ${((Date.now() - t0) / 1000).toFixed(1)}s${failures.length ? ` (${failures.join(', ')} failed)` : ''}`)
    } finally {
      running = null
    }
  })()
  return running
}

export function isImportRunning(): boolean {
  return running !== null
}

export { SHEET_BASE_URL }

// ---------------------------------------------------------------- legacy helpers
// Used by `diff-sheet.ts` and `repull-levels.ts`.

export async function fetchTabRows(gid: string): Promise<{ text: string[][]; html: string[][] }> {
  const table = parseTable(await fetchTabHtml(gid))
  if (!table) throw new Error(`gid=${gid}: no table found`)
  return table
}

export const PLACEMENT_HEADERS = ['placement', '#'] as const

/** Header row and lowercase-title → column map, for the maintenance scripts. */
export function findHeaderColumns(rows: string[][]): { headerIdx: number; cols: Record<string, number> } | null {
  const headerIdx = findHeaderRow(rows)
  if (headerIdx == null) return null
  const cols: Record<string, number> = {}
  rows[headerIdx]!.forEach((c, idx) => { if (c) cols[c.toLowerCase()] = idx })
  return { headerIdx, cols }
}

export function resolvePlacementColumn(cols: Record<string, number>): number | undefined {
  for (const header of PLACEMENT_HEADERS) {
    const idx = cols[header]
    if (idx != null) { cols['placement'] = idx; return idx }
  }
  return undefined
}

export function refineColumns(textRows: string[][], cols: Record<string, number>, dataStart: number): Record<string, number> {
  const sample = textRows.slice(dataStart, dataStart + 50).filter((r) => r.some((c) => c))
  if (!sample.length) return cols
  const refined = { ...cols }
  for (const [name, idx] of Object.entries(cols)) {
    if (sample.some((r) => (r[idx] ?? '').trim() !== '')) continue
    if (sample.some((r) => (r[idx + 1] ?? '').trim() !== '')) refined[name] = idx + 1
  }
  return refined
}

// Run as a CLI when invoked directly via `node server/db/import.ts`
const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import\.ts$/.test(process.argv[1])
if (isCli) {
  runImport().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

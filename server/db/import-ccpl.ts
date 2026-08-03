import { getDb } from './index.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'
import { buildAnchors, estimateForSourcePosition } from '../utils/import-estimates.ts'
import { getTierCurve } from '../utils/tier-curve.ts'

/**
 * CCPL — the **ALL CHALLENGES LIST** sheet.
 *
 * A Google Sheet rather than an API, read the same way the main ALL sheet is:
 * one CSV per tab through the gviz endpoint, which needs no key as long as the
 * document is link-readable.
 *
 * `CCPL` is already one of `utils/challenge-sources.ts`'s challenge sources, so
 * a level promoted from here is classified as a challenge by placement source
 * alone — no separate flag, and the challenge sub-ranking picks it up for free.
 *
 * ## Reading the sheet
 *
 * The two content tabs disagree about their own layout, which is why the column
 * mapping below is resolved per tab rather than hard-coded:
 *
 *   EXTREME CHALLENGES  name@2  tier@4  id@6  …  source@14  placement@23
 *   INSANE CHALLENGES   name@1  tier@3  id@5  …  source@13  placement@15
 *
 * Worse, the EXTREME tab's header row labels only *some* of its columns — the
 * level ID and placement columns sit under blank headers. So labelled columns
 * are found by name and the two that matter most are found by **shape**: level
 * IDs are the column whose values are overwhelmingly 5–11 digit integers, and
 * the placement is the column that best matches the sequence 1, 2, 3, … Both
 * are logged on every run, so a layout change shows up as a different mapping
 * in the log rather than as silently empty data.
 */
const SHEET_ID = process.env.CCPL_SHEET_ID
  || '1tl3_d5vCMIAFxHZU-2prqw7hp9-DyFC_eDzS75tVi0U'

/** The tabs worth importing. `creation stuff` and `Progression?` are notes. */
const TABS: { gid: string; tab: string; label: string }[] = [
  { gid: '0', tab: 'extreme', label: 'EXTREME CHALLENGES' },
  { gid: '639245499', tab: 'insane', label: 'INSANE CHALLENGES' },
]

const csvUrl = (gid: string) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`

/** Minimal RFC-4180 reader: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

export type CcplColumns = {
  name: number
  gdId: number | null
  placement: number | null
  tier: number | null
  skillset: number | null
  comparable: number | null
  source: number | null
  aredl: number | null
}

const clean = (v: string | undefined) => (v ?? '').trim()

/** Column index whose header cell matches one of `names`, case-insensitively. */
function byHeader(header: string[], ...names: string[]): number | null {
  const wanted = names.map((n) => n.toLowerCase())
  for (let i = 0; i < header.length; i++) {
    if (wanted.includes(clean(header[i]).toLowerCase())) return i
  }
  return null
}

/**
 * The column holding Geometry Dash level IDs.
 *
 * Found by shape because one tab leaves its header blank. A level ID is a 5–11
 * digit integer; the placement column is also all digits, so the winner has to
 * be the column with the *most* values that are too long to be a rank.
 */
function findIdColumn(data: string[][], width: number): number | null {
  let best: { col: number; hits: number } | null = null
  for (let c = 0; c < width; c++) {
    let hits = 0
    for (const r of data) {
      const v = clean(r[c])
      if (/^\d{5,11}$/.test(v)) hits++
    }
    if (hits >= 20 && (!best || hits > best.hits)) best = { col: c, hits }
  }
  return best?.col ?? null
}

/**
 * The column holding the list's own ranking.
 *
 * Scored on how many of its values equal their own 1-based order of appearance:
 * a real placement column reads 1, 2, 3, … and nothing else on the sheet does.
 */
function findPlacementColumn(data: string[][], width: number): number | null {
  let best: { col: number; hits: number } | null = null
  for (let c = 0; c < width; c++) {
    let seen = 0
    let hits = 0
    for (const r of data) {
      const v = clean(r[c])
      if (!/^\d{1,5}$/.test(v)) continue
      seen++
      if (Number(v) === seen) hits++
    }
    if (hits >= 20 && (!best || hits > best.hits)) best = { col: c, hits }
  }
  return best?.col ?? null
}

/** Resolve a tab's columns: labelled ones by name, the rest by shape. */
export function resolveColumns(header: string[], data: string[][]): CcplColumns | null {
  const name = byHeader(header, 'level name', 'name')
  if (name == null) return null

  const width = Math.max(header.length, ...data.map((r) => r.length))
  return {
    name,
    gdId: byHeader(header, 'level id', 'id') ?? findIdColumn(data, width),
    placement: byHeader(header, 'placement', 'position', 'rank') ?? findPlacementColumn(data, width),
    tier: byHeader(header, 'ccpl tier', 'tier'),
    skillset: byHeader(header, 'skillset'),
    comparable: byHeader(header, 'comparable demon'),
    source: byHeader(header, 'source'),
    aredl: byHeader(header, 'aredl'),
  }
}

/** The header row is the first one naming the level column. */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (rows[i]!.some((c) => /^level name$/i.test(clean(c)))) return i
  }
  return 0
}

export type CcplRow = {
  tab: string
  position: number
  gd_id: number | null
  name: string
  ccpl_tier: string | null
  skillset: string | null
  comparable: string | null
  source: string | null
  aredl_note: string | null
}

async function fetchTab(gid: string, label: string, tab: string): Promise<CcplRow[]> {
  const res = await fetch(csvUrl(gid), { headers: { Accept: 'text/csv' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${label}`)
  const rows = parseCsv(await res.text())
  if (!rows.length) return []

  const headerIdx = findHeaderRow(rows)
  const header = rows[headerIdx]!
  const data = rows.slice(headerIdx + 1)
  const cols = resolveColumns(header, data)
  if (!cols) {
    console.warn(`[ccpl]   ${label}: no "Level Name" column — skipping`)
    return []
  }
  console.log(
    `[ccpl]   ${label}: name@${cols.name} id@${cols.gdId ?? '-'} placement@${cols.placement ?? '-'}`
    + ` tier@${cols.tier ?? '-'} source@${cols.source ?? '-'}`,
  )

  const get = (r: string[], c: number | null) => (c == null ? null : clean(r[c]) || null)
  const out: CcplRow[] = []
  let fallbackPos = 0

  for (const r of data) {
    const name = clean(r[cols.name])
    if (!name) continue

    // A row the sheet hasn't ranked still belongs in the mirror — it just
    // can't claim a placement, so it gets one past the end of the real ones
    // rather than colliding with row 1.
    const rawPos = get(r, cols.placement)
    const position = rawPos && /^\d+$/.test(rawPos) ? Number(rawPos) : ++fallbackPos + 100_000

    const rawId = get(r, cols.gdId)
    const gd_id = rawId && /^\d{5,11}$/.test(rawId) ? Number(rawId) : null

    out.push({
      tab,
      position,
      gd_id,
      name,
      ccpl_tier: get(r, cols.tier),
      skillset: get(r, cols.skillset),
      comparable: get(r, cols.comparable),
      source: get(r, cols.source),
      aredl_note: get(r, cols.aredl),
    })
  }
  return out
}

const PLACEMENT_SOURCE = 'CCPL'

export async function importCcpl(report?: ProgressReporter): Promise<void> {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  report?.({ phase: 'Fetching the sheet', done: 0, total: TABS.length })
  const all: CcplRow[] = []
  for (const [i, t] of TABS.entries()) {
    console.log(`[ccpl] Fetching ${t.label}…`)
    const rows = await fetchTab(t.gid, t.label, t.tab)
    console.log(`[ccpl]   ${rows.length} levels`)
    all.push(...rows)
    report?.({ phase: 'Fetching the sheet', done: i + 1, total: TABS.length })
  }

  if (!all.length) {
    console.warn('[ccpl] nothing returned — leaving existing data alone')
    return
  }

  const insOwn = db.prepare(`
    INSERT INTO ccpl_levels
      (tab, position, gd_id, name, ccpl_tier, skillset, comparable, source, aredl_note, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tab, position) DO UPDATE SET
      gd_id = excluded.gd_id, name = excluded.name, ccpl_tier = excluded.ccpl_tier,
      skillset = excluded.skillset, comparable = excluded.comparable,
      source = excluded.source, aredl_note = excluded.aredl_note,
      fetched_at = excluded.fetched_at
  `)
  const findLevel = db.prepare(`SELECT id FROM levels WHERE gd_id = ?`)
  const setPosition = db.prepare(`UPDATE levels SET ccpl_position = ? WHERE id = ?`)

  let merged = 0
  let ccplOnly = 0

  report?.({ phase: 'Writing levels', done: 0, total: all.length })
  db.exec('BEGIN')
  try {
    // Levels dropped from the sheet stop advertising a rank they no longer
    // hold. `ccpl_levels` rows are *upserted* rather than cleared first,
    // because `pending_levels.from_ccpl_id` points at these ids: wiping the
    // table gave every surviving row a new id, the pending rows' conflict
    // target stopped matching, and a second import queued all of them again.
    // Stale rows are removed after the upserts instead, by `fetched_at`.
    db.exec(`UPDATE levels SET ccpl_position = NULL WHERE ccpl_position IS NOT NULL`)

    for (const r of all) {
      insOwn.run(
        r.tab, r.position, r.gd_id, r.name, r.ccpl_tier,
        r.skillset, r.comparable, r.source, r.aredl_note, now,
      )
      if (!r.gd_id) { ccplOnly++; continue }
      const existing = findLevel.get(r.gd_id) as { id: number } | undefined
      if (!existing) { ccplOnly++; continue }
      // Only the ranked tab's numbers are a ranking worth publishing.
      if (r.tab === 'extreme' && r.position < 100_000) setPosition.run(r.position, existing.id)
      merged++
    }

    // Every row this run touched carries `now`; anything older is a slot the
    // sheet no longer has. Promoted rows are kept as the record of where a
    // level came from.
    const dropped = db.prepare(
      `DELETE FROM ccpl_levels WHERE promoted_to_position IS NULL AND fetched_at != ?`,
    ).run(now).changes
    if (dropped) console.log(`[ccpl]   ${dropped} rows no longer on the sheet`)

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  console.log(`[ccpl]   ${all.length} rows; ${merged} merged into the ALL, ${ccplOnly} CCPL-only`)

  // --- Queue the levels the ALL doesn't have for review ---
  report?.({ phase: 'Matching against the ALL', done: 0, total: null })
  const onlyHere = db.prepare(
    `SELECT p.id, p.gd_id, p.position, p.name
       FROM ccpl_levels p
       LEFT JOIN levels l ON l.gd_id = p.gd_id
      WHERE l.id IS NULL
        AND p.gd_id IS NOT NULL
        AND p.promoted_to_position IS NULL
        AND p.position < 100000`,
  ).all() as { id: number; gd_id: number; position: number; name: string }[]

  const curve = getTierCurve(db)
  const anchors = buildAnchors(
    (db.prepare(
      `SELECT p.position AS source_pos, l.position AS all_pos, l.gddl_tier AS tier
         FROM ccpl_levels p
         JOIN levels l ON l.gd_id = p.gd_id
        WHERE p.tab = 'extreme' AND p.position < 100000
        ORDER BY p.position ASC`,
    ).all() as { source_pos: number; all_pos: number; tier: string | null }[])
      .map((r) => ({ sourcePos: r.source_pos, allPos: r.all_pos, tier: r.tier })),
  )

  const insPending = db.prepare(
    `INSERT INTO pending_levels
       (gd_id, name, difficulty, notes, placement_source, placement_estimate,
        gddl_tier, gddl_tier_estimated, status, submitted_at, from_ccpl_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(from_ccpl_id) WHERE from_ccpl_id IS NOT NULL DO UPDATE SET
       placement_estimate = excluded.placement_estimate,
       gddl_tier = CASE
         WHEN pending_levels.gddl_tier_estimated = 1 OR pending_levels.gddl_tier IS NULL
           THEN excluded.gddl_tier
         ELSE pending_levels.gddl_tier
       END,
       gddl_tier_estimated = CASE
         WHEN pending_levels.gddl_tier_estimated = 1 OR pending_levels.gddl_tier IS NULL
           THEN excluded.gddl_tier_estimated
         ELSE pending_levels.gddl_tier_estimated
       END
     WHERE pending_levels.status = 'pending'`,
  )

  // Batched so node:sqlite's synchronous writer doesn't hold the event loop for
  // the whole loop — the same reason the gdtpl importer batches.
  const BATCH = 100
  let queued = 0
  report?.({ phase: 'Queuing new levels for review', done: 0, total: onlyHere.length })
  for (let i = 0; i < onlyHere.length; i += BATCH) {
    db.exec('BEGIN')
    try {
      for (const lv of onlyHere.slice(i, i + BATCH)) {
        const est = estimateForSourcePosition(anchors, lv.position, curve)
        // A CCPL rank that happens to equal the estimate is a coincidence of
        // the two lists being similar lengths near the top, not a placement.
        const placement = est.placement === lv.position ? null : est.placement
        const result = insPending.run(
          lv.gd_id, lv.name, 'Extreme Demon',
          `Imported from the ALL Challenges List · placement #${lv.position}`,
          PLACEMENT_SOURCE, placement, est.tier, est.tier ? 1 : 0, now, lv.id,
        )
        if (result.changes > 0) queued++
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    report?.({ phase: 'Queuing new levels for review', done: Math.min(i + BATCH, onlyHere.length), total: onlyHere.length })
    await new Promise((r) => setTimeout(r, 0))
  }

  console.log(
    `[ccpl] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — `
    + `${merged} merged, ${queued} queued for review.`,
  )
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv)
  && process.argv[1] && /import-ccpl\.ts$/.test(process.argv[1])
if (isCli) {
  importCcpl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

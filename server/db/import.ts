import { getDb } from './index.ts'
import { recomputePoints } from '../utils/points.ts'

const SHEET_BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqB-B4XtOCo-tsy5TCCFljoOClmAmrrE4oxowHVhrCcQW5r-_f6xSXOezekRsrR55_QBHhrsVlxXLH'

export const TABS = [
  { gid: '0',          label: 'Main (Extreme Demons)' },
  { gid: '1036115495', label: 'Tier 4 Demons' },
  { gid: '1989779679', label: 'Subtier 5 Harder' },
  { gid: '516171001',  label: 'Subtier 4 Harder' },
  { gid: '1985672631', label: 'Subtier 3 Hard' },
  { gid: '1875166663', label: 'Subtier 1 Easy' },
]
const LEADERBOARD_GID = '280339977'
const STATS_VIEWER_GID = '943829784'
const VOID_LIST_GID = '1630809094'

// ---------- HTML helpers ----------
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
}
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim()
}

/**
 * Splits a `<tbody>...</tbody>` blob into individual `<tr>...</tr>` strings.
 * Done by streaming-style scan to avoid catastrophic regex backtracking on 18MB inputs.
 */
function splitRows(tbody: string): string[] {
  const rows: string[] = []
  let i = 0
  while (i < tbody.length) {
    const start = tbody.indexOf('<tr', i)
    if (start === -1) break
    const end = tbody.indexOf('</tr>', start)
    if (end === -1) break
    rows.push(tbody.slice(start, end + 5))
    i = end + 5
  }
  return rows
}

/**
 * Splits a `<tr>...` blob into its `<td>` cell HTML strings (in order).
 * The leading `<th>` (row number) is dropped.
 */
function splitCells(tr: string): string[] {
  const cells: string[] = []
  let i = 0
  while (i < tr.length) {
    const start = tr.indexOf('<td', i)
    if (start === -1) break
    const tagEnd = tr.indexOf('>', start)
    if (tagEnd === -1) break
    const close = tr.indexOf('</td>', tagEnd)
    if (close === -1) break
    cells.push(tr.slice(tagEnd + 1, close))
    i = close + 5
  }
  return cells
}

/**
 * Extract the real destination URL from a Google `https://www.google.com/url?q=...&sa=D...`
 * redirect, or return the URL unchanged if it isn't one.
 */
function unwrapGoogleRedirect(url: string): string {
  const m = url.match(/^https?:\/\/www\.google\.com\/url\?q=([^&]+)/)
  if (!m) return url
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return url
  }
}

/**
 * Returns the first `<a href="...">` URL inside a cell HTML string, unwrapped from
 * Google's redirect. Returns null if there is no link.
 */
export function extractLinkHref(cellHtml: string): string | null {
  const m = cellHtml.match(/<a[^>]*\shref="([^"]+)"/i)
  if (!m) return null
  return unwrapGoogleRedirect(decodeEntities(m[1]!))
}

// ---------- header detection ----------
/**
 * Each tab's first non-empty data row in `<tbody>` is the header row.
 * Returns a map of normalized header name -> column index.
 */
export function findHeaderColumns(rows: string[][]): { headerIdx: number; cols: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (r.some((c) => c.toLowerCase() === 'level name' || c.toLowerCase() === 'player name')) {
      const cols: Record<string, number> = {}
      r.forEach((c, idx) => { if (c) cols[c.toLowerCase()] = idx })
      return { headerIdx: i, cols }
    }
  }
  return null
}

export async function fetchTabRows(gid: string): Promise<{ text: string[][]; html: string[][] }> {
  const url = `${SHEET_BASE_URL}/pubhtml/sheet?headers=false&gid=${gid}`
  const res = await fetch(url, { headers: { 'User-Agent': 'all-levels-list-importer/1.0' } })
  if (!res.ok) throw new Error(`fetch gid=${gid} failed: ${res.status}`)
  const html = await res.text()
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) throw new Error(`gid=${gid}: no tbody found`)
  const trs = splitRows(tbodyMatch[1]!)
  const htmlRows = trs.map(splitCells)
  const textRows = htmlRows.map((cells) => cells.map(stripTags))
  return { text: textRows, html: htmlRows }
}

// ---------- numeric/text helpers ----------
export function num(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
export function txt(s: string | undefined): string | null {
  const t = (s ?? '').trim()
  return t === '' ? null : t
}

// ---------- import driver ----------
/**
 * Headers and data are sometimes off by one column in tabs that have extra
 * icon/spacer columns (notably the Main tab). For each named column, peek at
 * the next few data rows and shift right by 1 if the labelled column is empty
 * but the next column has content.
 */
export function refineColumns(textRows: string[][], cols: Record<string, number>, dataStart: number): Record<string, number> {
  const sample = textRows.slice(dataStart, dataStart + 8).filter((r) => r.length > 5)
  if (sample.length === 0) return cols
  const refined = { ...cols }
  for (const [name, idx] of Object.entries(cols)) {
    const hasHere = sample.some((r) => (r[idx] ?? '').trim() !== '')
    if (hasHere) continue
    const hasNext = sample.some((r) => (r[idx + 1] ?? '').trim() !== '')
    if (hasNext) refined[name] = idx + 1
  }
  return refined
}

/**
 * One-time cleanup for DBs populated before the (gd_id, name) dedupe was in
 * place. Earlier importLevels runs counted positions up from MAX(position)+1,
 * so every re-import created another full copy of every sheet level. Group by
 * (gd_id, lower(name)); per group, keep the permanent row if any, otherwise
 * the lowest id (oldest, most stable for FK references); re-point records,
 * opinions, and pending_levels to the survivor; delete the rest. Idempotent —
 * no-op once the DB is clean.
 *
 * Grouping is done in JS rather than via GROUP_CONCAT/window functions because
 * earlier SQL-based versions silently produced no diagnostic output when they
 * failed; this version always logs the group count and verifies afterward.
 */
function cleanupDuplicateLevels(db: ReturnType<typeof getDb>): void {
  type Row = { id: number; gd_id: number | null; name: string; permanent: number }
  const rows = db.prepare(`SELECT id, gd_id, name, permanent FROM levels`).all() as Row[]

  const groups = new Map<string, { id: number; perm: boolean }[]>()
  for (const r of rows) {
    const key = `${r.gd_id ?? ''}|${r.name.toLowerCase()}`
    let g = groups.get(key)
    if (!g) { g = []; groups.set(key, g) }
    g.push({ id: r.id, perm: r.permanent === 1 })
  }

  const remap: { drop: number; keep: number }[] = []
  let dupGroups = 0
  for (const g of groups.values()) {
    if (g.length < 2) continue
    dupGroups++
    // Prefer permanent rows; among ties, lowest id wins.
    g.sort((a, b) => Number(b.perm) - Number(a.perm) || a.id - b.id)
    const keep = g[0]!.id
    for (let i = 1; i < g.length; i++) remap.push({ drop: g[i]!.id, keep })
  }

  console.log(`Dedupe scan: ${rows.length} rows, ${groups.size} unique (gd_id, name), ${dupGroups} duplicated, ${remap.length} rows to remove.`)
  if (remap.length === 0) return

  const updRecords  = db.prepare(`UPDATE records  SET level_id = ? WHERE level_id = ?`)
  const updOpinions = db.prepare(`UPDATE opinions SET level_id = ? WHERE list_kind = 'main' AND level_id = ?`)
  const updPending  = db.prepare(`UPDATE pending_levels SET comparison_level_id = ? WHERE comparison_level_id = ?`)
  const delLevel    = db.prepare(`DELETE FROM levels WHERE id = ?`)

  db.exec('BEGIN')
  try {
    for (const { drop, keep } of remap) {
      updRecords.run(keep, drop)
      updOpinions.run(keep, drop)
      updPending.run(keep, drop)
      delLevel.run(drop)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    console.error('Cleanup failed, rolled back:', e)
    throw e
  }

  // Sanity check — query the DB again and confirm zero duplicate groups remain.
  const remaining = db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM levels GROUP BY COALESCE(gd_id, -1), LOWER(name) HAVING COUNT(*) > 1
    )
  `).get() as { n: number }
  console.log(`Removed ${remap.length} duplicate level rows. ${remaining.n} duplicate groups remain.`)
  if (remaining.n > 0) {
    console.warn(`WARNING: cleanup completed but ${remaining.n} duplicate groups still present — please report.`)
  }
}

const dupKey = (gd: number | null, n: string) => `${gd ?? ''}|${n.toLowerCase()}`

async function importLevels() {
  const db = getDb()

  cleanupDuplicateLevels(db)

  // `rated` is intentionally not imported from the sheet — the GD API is the
  // source of truth for ratings. `points` is also skipped — values are derived
  // from gddl_tier + position via recomputePoints() and the sheet column is no
  // longer authoritative. New rows are inserted with rated = NULL, points = NULL.
  const insert = db.prepare(`
    INSERT INTO levels
      (position, name, gd_id, gddl_tier, difficulty, placement_source,
       main_skillset, verify_date, verification, verification_url, pov_placement,
       year_verified, category, source_tab)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', ?)
  `)

  // Levels that have a permanent counterpart are owned by the website, not the
  // sheet — skip any incoming row matching one of these gd_ids.
  const permGdIds = new Set(
    (db.prepare(`SELECT gd_id FROM levels WHERE permanent = 1 AND gd_id IS NOT NULL`).all() as { gd_id: number }[])
      .map((r) => r.gd_id),
  )

  // Pre-load existing rows so we can decide insert vs. reuse-and-reposition.
  // Lowercased name matches the COLLATE NOCASE index on levels.name.
  const existingByKey = new Map<string, number>()  // key -> id
  for (const row of db
    .prepare(`SELECT id, gd_id, name FROM levels WHERE permanent = 0 OR permanent IS NULL`)
    .all() as { id: number; gd_id: number | null; name: string }[]) {
    existingByKey.set(dupKey(row.gd_id, row.name), row.id)
  }

  // Sheet placement numbers are not authoritative — the row order *within* each
  // tab is. Same level appearing on multiple tabs (e.g. main + tier-specific)
  // collapses to a single row; the first tab to claim it wins, matching the
  // TABS order (Main, then tiers). The placement column is still read, but only
  // as a "is this a real level row" signal (decoration / section-header rows
  // have no placement value).
  //
  // Newly-encountered rows are inserted with a temporary position above
  // MAX(position); applySheetOrder below renumbers everything to match the
  // sheet's current ordering.
  let tempPos = (db.prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM levels`).get() as { m: number }).m

  const sheetOrder: { key: string; gdId: number | null; name: string }[] = []
  let total = 0
  let skipped = 0
  let permSkipped = 0

  for (const tab of TABS) {
    process.stdout.write(`Fetching tab "${tab.label}" (gid=${tab.gid})... `)
    const { text, html } = await fetchTabRows(tab.gid)
    const found = findHeaderColumns(text)
    if (!found) { console.log('no header row, skipping'); continue }
    const c = refineColumns(text, found.cols, found.headerIdx + 1)
    // The "Placement on Verification" column in the published sheet has a
    // uniform "1" indicator cell at the labelled column; the actual placement
    // value lives one column to the right. refineColumns can't detect this
    // because it only shifts when the labelled cell is empty.
    if (c['placement on verification'] != null) {
      c['placement on verification'] = c['placement on verification'] + 1
    }
    const sourceCol = c['source'] ?? c['primary source']
    const verCol = c['verification link']
    let imported = 0

    db.exec('BEGIN')
    try {
      for (let i = found.headerIdx + 1; i < text.length; i++) {
        const r = text[i]!
        const rh = html[i]!
        const name = txt(r[c['level name']!])
        const placement = num(r[c['placement']!])
        // Filter, don't assign — placement === null means decoration row.
        if (!name || placement === null) { skipped++; continue }
        const gdId = num(r[c['level id']!])
        if (gdId !== null && permGdIds.has(gdId)) { permSkipped++; continue }
        const key = dupKey(gdId, name)
        // Already encountered earlier in the sheet (or already in the DB) —
        // record sheet rank but don't re-insert.
        if (sheetOrder.some((s) => s.key === key)) continue
        sheetOrder.push({ key, gdId, name })

        if (existingByKey.has(key)) continue

        tempPos++
        const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
        // Placement on verification is only trusted on the Main tab (gid=0);
        // tier-specific tabs have stale / off-by-one values for these.
        const povCol = c['placement on verification']
        const pov = tab.gid === '0' && povCol != null ? num(r[povCol]!) : null
        const result = insert.run(
          tempPos,
          name,
          gdId,
          txt(r[c['gddl tier']!]),
          txt(r[c['difficulty']!]),
          sourceCol != null ? txt(r[sourceCol]) : null,
          txt(r[c['main skillset']!]),
          txt(r[c['verify date']!]),
          verCol != null ? txt(r[verCol]) : null,
          verHref,
          pov,
          num(r[c['year verified']!]),
          tab.label,
        )
        existingByKey.set(key, Number(result.lastInsertRowid))
        imported++
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    console.log(`${imported} new`)
    total += imported
  }

  // Renumber non-permanent rows so positions match the freshly-collected sheet
  // order. Permanent levels are anchors — their positions are kept fixed and
  // sheet entries flow around them. Rows still in the DB but no longer on the
  // sheet (e.g. a level the curators removed) drift to the end of the list,
  // ordered by their previous position; nothing is deleted automatically.
  const orphans = applySheetOrder(db, sheetOrder)

  // Points are derived from tier + position; recompute against the freshly
  // settled list ordering so every level (including imports just renumbered)
  // ends up with a current value.
  recomputePoints(db)

  console.log(
    `\nImported ${total} new levels; renumbered all non-permanent rows by sheet order ` +
    `(${orphans} not in current sheet, kept at end). ${skipped} blank rows, ` +
    `${permSkipped} skipped — owned by permanent records. Points recomputed.`,
  )
}

/**
 * Two-phase reposition. Sheet entries get sequential positions starting at 1,
 * skipping over positions held by permanent levels (which are website-owned and
 * never move). DB rows that don't match a sheet entry are appended after the
 * sheet entries in their previous-position order. Everything happens inside a
 * single transaction; the negative-position parking step lets us swap rows
 * without tripping the position UNIQUE constraint mid-way.
 *
 * Returns the count of non-permanent rows that weren't matched against the
 * sheet (orphans).
 */
function applySheetOrder(
  db: ReturnType<typeof getDb>,
  sheetOrder: { key: string; gdId: number | null; name: string }[],
): number {
  const sheetRank = new Map<string, number>()
  sheetOrder.forEach((s, i) => sheetRank.set(s.key, i))

  const allNonPerm = db
    .prepare(`SELECT id, gd_id, name, position FROM levels WHERE permanent = 0 OR permanent IS NULL`)
    .all() as { id: number; gd_id: number | null; name: string; position: number }[]

  const ranked = allNonPerm.map((r) => ({
    id: r.id,
    rank: sheetRank.get(dupKey(r.gd_id, r.name)) ?? Number.POSITIVE_INFINITY,
    fallbackPos: r.position,
  }))
  ranked.sort((a, b) => a.rank - b.rank || a.fallbackPos - b.fallbackPos)

  const permPositions = new Set(
    (db.prepare(`SELECT position FROM levels WHERE permanent = 1`).all() as { position: number }[])
      .map((r) => r.position),
  )
  const targets: number[] = []
  let p = 1
  while (targets.length < ranked.length) {
    if (!permPositions.has(p)) targets.push(p)
    p++
  }

  const setPos = db.prepare(`UPDATE levels SET position = ? WHERE id = ?`)
  db.exec('BEGIN')
  try {
    // Park every non-permanent row at a unique negative position so the final
    // assignment can't collide with a value still held by another row in this
    // batch. Permanent positions are positive, so negatives are conflict-free.
    for (let i = 0; i < ranked.length; i++) setPos.run(-(i + 1), ranked[i]!.id)
    for (let i = 0; i < ranked.length; i++) setPos.run(targets[i]!, ranked[i]!.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return ranked.filter((r) => !Number.isFinite(r.rank)).length
}

async function importLeaderboard() {
  const db = getDb()
  process.stdout.write(`Fetching leaderboard (gid=${LEADERBOARD_GID})... `)
  const { text } = await fetchTabRows(LEADERBOARD_GID)
  const found = findHeaderColumns(text)
  if (!found) { console.log('no header row, skipping'); return }
  const c = found.cols

  db.exec('DELETE FROM players')
  const insert = db.prepare(`
    INSERT INTO players (name, total_points, skill_points, hardest, tier)
    VALUES (?, ?, ?, ?, ?)
  `)

  let imported = 0
  db.exec('BEGIN')
  try {
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const name = txt(r[c['player name']!])
      if (!name) continue
      const tot = num(r[c['total points']!]) ?? 0
      const skl = num(r[c['skill points']!]) ?? 0
      if (tot === 0 && skl === 0) continue
      insert.run(name, tot, skl, txt(r[c['hardest']!]), txt(r[c['tier']!]))
      imported++
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  console.log(`${imported} players`)
}

/**
 * Stats Viewer tab — wide spreadsheet, one 5-column block per player:
 *   col 5N+1: separator
 *   col 5N+2: Level Name
 *   col 5N+3: Points
 *   col 5N+4: ALL Place  (the global level position; the level_id isn't shown)
 *   col 5N+5: GDDL Tier
 *
 * The player names sit in an early row at col 5N+2 (same column as Level Name).
 * We look levels up by `position = ALL Place` since the tab doesn't expose gd_id.
 */
type CellPos = { col: number; text: string }

function parseRowWithCols(rowHtml: string): CellPos[] {
  const cells: CellPos[] = []
  let col = 0
  const re = /<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rowHtml)) !== null) {
    const attrs = m[2]!
    const content = m[3]!
    const csMatch = attrs.match(/colspan="(\d+)"/)
    const cs = csMatch ? Number(csMatch[1]) : 1
    cells.push({ col, text: stripTags(content) })
    col += cs
  }
  return cells
}

async function importStatsViewer() {
  const db = getDb()
  process.stdout.write(`Fetching stats viewer (gid=${STATS_VIEWER_GID})... `)

  const url = `${SHEET_BASE_URL}/pubhtml/sheet?headers=false&gid=${STATS_VIEWER_GID}`
  const res = await fetch(url, { headers: { 'User-Agent': 'all-levels-list-importer/1.0' } })
  if (!res.ok) throw new Error(`fetch stats viewer failed: ${res.status}`)
  const html = await res.text()
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) { console.log('no tbody, skipping'); return }
  const trs = splitRows(tbodyMatch[1]!)
  const rows = trs.map(parseRowWithCols)

  // Find player-name row: the one containing 'Total Points' labels.
  let playerRowIdx = -1
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    if (rows[i]!.some((c) => c.text === 'Total Points')) { playerRowIdx = i; break }
  }
  if (playerRowIdx < 0) { console.log('no player row, skipping'); return }

  // Find level-header row: the one containing 'ALL Place'.
  let headerRowIdx = -1
  for (let i = playerRowIdx + 1; i < Math.min(12, rows.length); i++) {
    if (rows[i]!.some((c) => c.text.toLowerCase() === 'all place')) { headerRowIdx = i; break }
  }
  if (headerRowIdx < 0) { console.log('no header row, skipping'); return }

  // Build block index → player name. Player names are at col 5N+2 (block-local pos 1).
  const players = new Map<number, string>()
  for (const c of rows[playerRowIdx]!) {
    if (c.col < 1 || !c.text) continue
    const block = Math.floor((c.col - 1) / 5)
    const pos = (c.col - 1) % 5
    if (pos !== 1) continue
    if (c.text === 'Total Points' || c.text === 'Skill Points') continue
    players.set(block, c.text)
  }

  // Sheet records are auto-accepted (permanent = 1). They never went through the
  // submission queue, and not every legacy entry has a video link of consistent
  // shape, so we don't store one here either.
  const insert = db.prepare(
    `INSERT INTO records (level_id, player_id, player_name, video, permanent, submitted_by)
     VALUES (?, ?, ?, NULL, 1, NULL)`,
  )
  // Resolve by name first — that's the most stable key the stats viewer exposes.
  // Position lookup is the fallback: admin moves/deletes can shift DB positions
  // out of sync with the sheet's "ALL Place", and matching by position would
  // then bind records to the wrong level. The resulting level_id is the
  // levels.id PK (stable for the lifetime of the row), so once stored, records
  // stay correctly attached even if the level later moves.
  const findLevelByName = db.prepare(
    `SELECT id FROM levels WHERE name = ? COLLATE NOCASE ORDER BY position ASC LIMIT 1`,
  )
  const findLevelByPosition = db.prepare(`SELECT id FROM levels WHERE position = ?`)
  const findPlayer = db.prepare(`SELECT id FROM players WHERE name = ? COLLATE NOCASE`)

  let imported = 0
  let missingLevels = 0
  let dupes = 0

  // De-dup cases where the sheet lists the same player + level twice.
  const seen = new Set<string>()

  db.exec('BEGIN')
  try {
    // Wipe all sheet-source records and re-import. User submissions
    // (submitted_by IS NOT NULL) are preserved regardless of permanent state.
    db.exec(`DELETE FROM records WHERE submitted_by IS NULL`)

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i]!
      // Group cells by block index → { name, place }
      const blocks = new Map<number, { name?: string; place?: string }>()
      for (const c of row) {
        if (c.col < 1) continue
        const block = Math.floor((c.col - 1) / 5)
        const pos = (c.col - 1) % 5
        if (pos !== 1 && pos !== 3) continue
        let entry = blocks.get(block)
        if (!entry) { entry = {}; blocks.set(block, entry) }
        if (pos === 1) entry.name = c.text
        else entry.place = c.text
      }

      for (const [block, fields] of blocks) {
        const player = players.get(block)
        if (!player || !fields.name) continue
        const place = num(fields.place ?? '')

        const levelName = (fields.name ?? '').trim()
        const lvl = (levelName ? findLevelByName.get(levelName) as { id: number } | undefined : undefined)
                 ?? (place !== null && place > 0
                       ? findLevelByPosition.get(place) as { id: number } | undefined
                       : undefined)
        if (!lvl) { missingLevels++; continue }

        const dedupeKey = `${lvl.id}:${player.toLowerCase()}`
        if (seen.has(dedupeKey)) { dupes++; continue }
        seen.add(dedupeKey)

        const p = findPlayer.get(player) as { id: number } | undefined
        insert.run(lvl.id, p?.id ?? null, player)
        imported++
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  console.log(`${imported} records (${dupes} duplicates, ${missingLevels} skipped — no matching position)`)
}

export async function importVoidList() {
  const db = getDb()
  process.stdout.write(`Fetching void list (gid=${VOID_LIST_GID})... `)
  const { text, html } = await fetchTabRows(VOID_LIST_GID)
  const found = findHeaderColumns(text)
  if (!found) { console.log('no header row, skipping'); return }
  const c = found.cols
  const verCol = c['verification link']

  // Wipe and re-import — void list churns frequently as levels move into the main list.
  db.exec(`DELETE FROM void_levels`)
  const insert = db.prepare(`
    INSERT OR IGNORE INTO void_levels
      (position, name, gd_id, verify_date, days, demon_ranking,
       placement_source, verification, verification_url, added_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let pos = 0
  let imported = 0
  db.exec('BEGIN')
  try {
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const rh = html[i]!
      const name = txt(r[c['level name']!])
      if (!name) continue
      const gdId = num(r[c['level id']!])
      const verifyDate = txt(r[c['verify date']!])
      const days = num(r[c['days']!])
      const demonRank = txt(r[c['demon ranking']!])
      const source = txt(r[c['source']!] ?? r[c['primary source']!])
      // Skip section header / blank rows — they have a name but no actual level data.
      if (!gdId && !verifyDate && days == null && !demonRank && !source) continue
      pos++
      const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
      insert.run(
        pos, name, gdId, verifyDate, days, demonRank, source,
        verCol != null ? txt(r[verCol]) : null, verHref,
        txt(r[c['added to pending on']!]),
      )
      imported++
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  console.log(`${imported} levels`)
}

export async function runImport() {
  const t0 = Date.now()
  await importLevels()
  await importLeaderboard()
  await importStatsViewer()
  await importVoidList()
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
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

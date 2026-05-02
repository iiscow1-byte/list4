import { getDb } from './index.ts'

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
 * so every re-import created another full copy of every sheet level. Find each
 * (gd_id, lower(name)) group, keep the row with the lowest id (oldest, most
 * stable for FK references), re-point records/opinions/pending_levels to the
 * survivor, and delete the rest. Idempotent — no-op once the DB is clean.
 */
function cleanupDuplicateLevels(db: ReturnType<typeof getDb>): number {
  const groups = db.prepare(`
    SELECT MIN(id) AS keep_id, GROUP_CONCAT(id) AS all_ids
    FROM levels
    GROUP BY COALESCE(gd_id, -1), LOWER(name)
    HAVING COUNT(*) > 1
  `).all() as { keep_id: number; all_ids: string }[]
  if (groups.length === 0) return 0

  let removed = 0
  db.exec('BEGIN')
  try {
    for (const g of groups) {
      const ids = g.all_ids.split(',').map(Number)
      const dropIds = ids.filter((id) => id !== g.keep_id)
      if (dropIds.length === 0) continue
      const placeholders = dropIds.map(() => '?').join(',')
      db.prepare(`UPDATE records  SET level_id            = ? WHERE level_id            IN (${placeholders})`).run(g.keep_id, ...dropIds)
      db.prepare(`UPDATE opinions SET level_id            = ? WHERE list_kind = 'main' AND level_id IN (${placeholders})`).run(g.keep_id, ...dropIds)
      db.prepare(`UPDATE pending_levels SET comparison_level_id = ? WHERE comparison_level_id IN (${placeholders})`).run(g.keep_id, ...dropIds)
      db.prepare(`DELETE FROM levels WHERE id IN (${placeholders})`).run(...dropIds)
      removed += dropIds.length
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return removed
}

async function importLevels() {
  const db = getDb()

  const removed = cleanupDuplicateLevels(db)
  if (removed > 0) console.log(`Removed ${removed} duplicate level rows from prior imports.`)

  // `rated` is intentionally not imported from the sheet — the GD API is the
  // source of truth for ratings. New rows are inserted with rated = NULL.
  const insert = db.prepare(`
    INSERT OR IGNORE INTO levels
      (position, name, gd_id, gddl_tier, difficulty, placement_source, points,
       main_skillset, verify_date, verification, verification_url, pov_placement,
       year_verified, category, source_tab)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', ?)
  `)

  // Levels that have a permanent counterpart are owned by the website, not the
  // sheet — skip any incoming row matching one of these gd_ids.
  const permGdIds = new Set(
    (db.prepare(`SELECT gd_id FROM levels WHERE permanent = 1 AND gd_id IS NOT NULL`).all() as { gd_id: number }[])
      .map((r) => r.gd_id),
  )

  // Sheet placement numbers are no longer authoritative — we just count up.
  // Same level appearing on multiple tabs (e.g. main + tier-specific) collapses
  // to a single row; the first tab to claim it wins, matching the TABS order
  // (Main, then tiers). The placement column is still read, but only as a
  // "is this a real level row" signal (decoration / section-header rows have
  // no placement value).
  //
  // Re-runs against a populated DB skip rows that already exist — keyed on
  // (gd_id, name) so positions don't drift across imports.
  const startingPos = (db.prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM levels`).get() as { m: number }).m
  let pos = startingPos

  // Pre-load existing (gd_id, name) pairs to detect duplicates across runs.
  // Lowercased name matches the COLLATE NOCASE index on levels.name.
  const dupKey = (gd: number | null, n: string) => `${gd ?? ''}|${n.toLowerCase()}`
  const seen = new Set<string>()
  for (const row of db.prepare(`SELECT gd_id, name FROM levels`).all() as { gd_id: number | null; name: string }[]) {
    seen.add(dupKey(row.gd_id, row.name))
  }

  let total = 0
  let skipped = 0
  let collisions = 0
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
        if (seen.has(key)) { collisions++; continue }
        seen.add(key)
        pos++
        const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
        const result = insert.run(
          pos,
          name,
          gdId,
          txt(r[c['gddl tier']!]),
          txt(r[c['difficulty']!]),
          sourceCol != null ? txt(r[sourceCol]) : null,
          num(r[c['points']!]),
          txt(r[c['main skillset']!]),
          txt(r[c['verify date']!]),
          verCol != null ? txt(r[verCol]) : null,
          verHref,
          num(r[c['placement on verification']!]),
          num(r[c['year verified']!]),
          tab.label,
        )
        if (result.changes === 0) collisions++
        else imported++
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    console.log(`${imported} levels`)
    total += imported
  }

  console.log(`\nImported ${total} levels (${skipped} blank, ${collisions} position conflicts, ${permSkipped} skipped — owned by permanent records).`)
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

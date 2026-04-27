import { getDb } from './index.ts'

const SHEET_BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqB-B4XtOCo-tsy5TCCFljoOClmAmrrE4oxowHVhrCcQW5r-_f6xSXOezekRsrR55_QBHhrsVlxXLH'

const TABS = [
  { gid: '0',          label: 'Main (Extreme Demons)' },
  { gid: '1036115495', label: 'Tier 4 Demons' },
  { gid: '1989779679', label: 'Subtier 5 Harder' },
  { gid: '516171001',  label: 'Subtier 4 Harder' },
  { gid: '1985672631', label: 'Subtier 3 Hard' },
  { gid: '1875166663', label: 'Subtier 1 Easy' },
]
const LEADERBOARD_GID = '280339977'

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
function extractLinkHref(cellHtml: string): string | null {
  const m = cellHtml.match(/<a[^>]*\shref="([^"]+)"/i)
  if (!m) return null
  return unwrapGoogleRedirect(decodeEntities(m[1]!))
}

// ---------- header detection ----------
/**
 * Each tab's first non-empty data row in `<tbody>` is the header row.
 * Returns a map of normalized header name -> column index.
 */
function findHeaderColumns(rows: string[][]): { headerIdx: number; cols: Record<string, number> } | null {
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

async function fetchTabRows(gid: string): Promise<{ text: string[][]; html: string[][] }> {
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
function num(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
function txt(s: string | undefined): string | null {
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
function refineColumns(textRows: string[][], cols: Record<string, number>, dataStart: number): Record<string, number> {
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

async function importLevels() {
  const db = getDb()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO levels
      (position, name, gd_id, gddl_tier, rated, difficulty, placement_source, points,
       main_skillset, verify_date, verification, verification_url, pov_placement,
       year_verified, category, source_tab)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', ?)
  `)

  let total = 0
  let skipped = 0
  let collisions = 0

  for (const tab of TABS) {
    process.stdout.write(`Fetching tab "${tab.label}" (gid=${tab.gid})... `)
    const { text, html } = await fetchTabRows(tab.gid)
    const found = findHeaderColumns(text)
    if (!found) { console.log('no header row, skipping'); continue }
    const c = refineColumns(text, found.cols, found.headerIdx + 1)
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
        if (!name || placement === null) { skipped++; continue }
        const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
        const result = insert.run(
          placement,
          name,
          num(r[c['level id']!]),
          txt(r[c['gddl tier']!]),
          txt(r[c['rated']!]),
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

  console.log(`\nImported ${total} levels (${skipped} blank rows skipped, ${collisions} dropped on position conflict — earlier tab wins).`)
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

export async function runImport() {
  const t0 = Date.now()
  await importLevels()
  await importLeaderboard()
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

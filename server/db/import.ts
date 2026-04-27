import { getDb } from './index.ts'

const SHEET_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqB-B4XtOCo-tsy5TCCFljoOClmAmrrE4oxowHVhrCcQW5r-_f6xSXOezekRsrR55_QBHhrsVlxXLH/pub?output=csv'

/**
 * Each tab on the published sheet is a separate slice of the global ranking.
 * The header row sits at row 2 (1-indexed) — we identify columns by header name
 * since each tab includes a slightly different subset / order.
 */
const TABS = [
  { gid: '0',          label: 'Main (Extreme Demons)' },
  { gid: '1036115495', label: 'Tier 4 Demons' },
  { gid: '1989779679', label: 'Subtier 5 Harder' },
  { gid: '516171001',  label: 'Subtier 4 Harder' },
  { gid: '1985672631', label: 'Subtier 3 Hard' },
  { gid: '1875166663', label: 'Subtier 1 Easy' },
]

const LEADERBOARD_TAB = { gid: '280339977', label: 'Player Leaderboard' }

// ---------- minimal CSV parser (RFC 4180-ish) ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = [] }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

async function fetchTab(gid: string): Promise<string[][]> {
  const url = `${SHEET_BASE}&gid=${gid}`
  const res = await fetch(url, { headers: { 'User-Agent': 'all-levels-list-importer/1.0' } })
  if (!res.ok) throw new Error(`fetch gid=${gid} failed: ${res.status}`)
  return parseCsv(await res.text())
}

/**
 * Find a header row by looking for one that contains "Level Name" or "Player Name".
 * Returns { headerIdx, headers } where headers maps lowercase normalized name -> column index.
 */
function findHeaders(rows: string[][], required: string): { headerIdx: number; cols: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!.map((c) => c.trim())
    if (r.some((c) => c.toLowerCase() === required.toLowerCase())) {
      const cols: Record<string, number> = {}
      r.forEach((c, idx) => { if (c) cols[c.toLowerCase()] = idx })
      return { headerIdx: i, cols }
    }
  }
  return null
}

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

async function importLevels() {
  const db = getDb()

  const insert = db.prepare(`
    INSERT OR REPLACE INTO levels
      (position, name, gd_id, gddl_tier, rated, difficulty, placement_source, points,
       main_skillset, verify_date, verification, pov_placement, year_verified, category, source_tab)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', ?)
  `)

  let total = 0
  let skipped = 0

  for (const tab of TABS) {
    process.stdout.write(`Fetching tab "${tab.label}" (gid=${tab.gid})... `)
    const rows = await fetchTab(tab.gid)
    const found = findHeaders(rows, 'Level Name')
    if (!found) {
      console.log('no header row, skipping')
      continue
    }
    const c = found.cols
    let imported = 0
    db.exec('BEGIN')
    try {
      for (let i = found.headerIdx + 1; i < rows.length; i++) {
        const r = rows[i]!
        const name = txt(r[c['level name']!])
        const placement = num(r[c['placement']!])
        if (!name || placement === null) { skipped++; continue }
        insert.run(
          placement,
          name,
          num(r[c['level id']!]),
          txt(r[c['gddl tier']!]),
          txt(r[c['rated']!]),
          txt(r[c['difficulty']!]),
          txt(r[c['source'] ?? c['primary source']!]),
          num(r[c['points']!]),
          txt(r[c['main skillset']!]),
          txt(r[c['verify date']!]),
          txt(r[c['verification link']!]),
          num(r[c['placement on verification']!]),
          num(r[c['year verified']!]),
          tab.label,
        )
        imported++
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    console.log(`${imported} levels`)
    total += imported
  }

  console.log(`\nImported ${total} levels (${skipped} rows skipped: blank or missing placement).`)
}

async function importLeaderboard() {
  const db = getDb()
  process.stdout.write(`Fetching leaderboard tab (gid=${LEADERBOARD_TAB.gid})... `)
  const rows = await fetchTab(LEADERBOARD_TAB.gid)
  const found = findHeaders(rows, 'Player Name')
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
    for (let i = found.headerIdx + 1; i < rows.length; i++) {
      const r = rows[i]!
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

async function main() {
  const t0 = Date.now()
  await importLevels()
  await importLeaderboard()
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

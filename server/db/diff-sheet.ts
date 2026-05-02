import { getDb } from './index.ts'
import {
  TABS,
  fetchTabRows,
  findHeaderColumns,
  refineColumns,
  num,
  txt,
  extractLinkHref,
} from './import.ts'

/**
 * Pulls the published sheet and reports any field-level differences against the
 * `levels` table for rows that already exist in the DB. Read-only — prints a
 * report and exits. Use `npm run diff-sheet` to invoke; pass `--apply` to write
 * the changes back to the DB.
 *
 * Matching strategy: prefer `gd_id` (most stable), fall back to (name, source_tab).
 * Rows with no DB match are reported as "new" (the regular import handles those).
 */

type SheetRow = {
  gd_id: number | null
  name: string
  gddl_tier: string | null
  difficulty: string | null
  placement_source: string | null
  points: number | null
  main_skillset: string | null
  verify_date: string | null
  verification: string | null
  verification_url: string | null
  pov_placement: number | null
  year_verified: number | null
  source_tab: string
}

const COMPARED_FIELDS: (keyof SheetRow)[] = [
  'gddl_tier',
  'difficulty',
  'placement_source',
  'points',
  'main_skillset',
  'verify_date',
  'verification',
  'verification_url',
  'pov_placement',
  'year_verified',
]

function normalize(v: any): string {
  if (v == null) return ''
  if (typeof v === 'number') return String(v)
  return String(v).trim()
}

async function collectSheetRows(): Promise<SheetRow[]> {
  const out: SheetRow[] = []
  for (const tab of TABS) {
    process.stdout.write(`Fetching tab "${tab.label}" (gid=${tab.gid})... `)
    const { text, html } = await fetchTabRows(tab.gid)
    const found = findHeaderColumns(text)
    if (!found) { console.log('no header row, skipping'); continue }
    const c = refineColumns(text, found.cols, found.headerIdx + 1)
    if (c['placement on verification'] != null) {
      c['placement on verification'] = c['placement on verification'] + 1
    }
    const sourceCol = c['source'] ?? c['primary source']
    const verCol = c['verification link']

    let count = 0
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const rh = html[i]!
      const name = txt(r[c['level name']!])
      const placement = num(r[c['placement']!])
      if (!name || placement === null) continue
      const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
      out.push({
        gd_id: num(r[c['level id']!]),
        name,
        gddl_tier: txt(r[c['gddl tier']!]),
        difficulty: txt(r[c['difficulty']!]),
        placement_source: sourceCol != null ? txt(r[sourceCol]) : null,
        points: num(r[c['points']!]),
        main_skillset: txt(r[c['main skillset']!]),
        verify_date: txt(r[c['verify date']!]),
        verification: verCol != null ? txt(r[verCol]) : null,
        verification_url: verHref,
        pov_placement: num(r[c['placement on verification']!]),
        year_verified: num(r[c['year verified']!]),
        source_tab: tab.label,
      })
      count++
    }
    console.log(`${count} rows`)
  }
  return out
}

type DiffResult = {
  position: number
  name: string
  gd_id: number | null
  changes: { field: string; from: any; to: any }[]
}

async function diffSheet(opts: { apply: boolean }) {
  const db = getDb()
  const sheetRows = await collectSheetRows()

  // Build index: gd_id → DB row, plus (name|source_tab) → DB row as a fallback.
  const dbRows = db.prepare(`
    SELECT id, position, name, gd_id, gddl_tier, difficulty, placement_source, points,
           main_skillset, verify_date, verification, verification_url, pov_placement,
           year_verified, source_tab, permanent
    FROM levels
  `).all() as any[]

  const byGdId = new Map<number, any>()
  const byNameTab = new Map<string, any>()
  for (const r of dbRows) {
    if (r.gd_id != null) byGdId.set(r.gd_id, r)
    if (r.name && r.source_tab) {
      byNameTab.set(`${r.source_tab}::${r.name.toLowerCase()}`, r)
    }
  }

  const diffs: DiffResult[] = []
  let unmatched = 0
  let permSkipped = 0

  for (const s of sheetRows) {
    const dbRow = (s.gd_id != null ? byGdId.get(s.gd_id) : null)
              ?? byNameTab.get(`${s.source_tab}::${s.name.toLowerCase()}`)
    if (!dbRow) { unmatched++; continue }
    if (dbRow.permanent) { permSkipped++; continue }

    const changes: { field: string; from: any; to: any }[] = []
    for (const field of COMPARED_FIELDS) {
      const dbVal = dbRow[field]
      const sheetVal = (s as any)[field]
      if (normalize(dbVal) !== normalize(sheetVal)) {
        changes.push({ field, from: dbVal, to: sheetVal })
      }
    }
    if (changes.length) {
      diffs.push({ position: dbRow.position, name: dbRow.name, gd_id: dbRow.gd_id, changes })
    }
  }

  console.log('')
  if (diffs.length === 0) {
    console.log('No field changes detected on existing levels.')
  } else {
    console.log(`Found ${diffs.length} levels with changed fields:\n`)
    for (const d of diffs) {
      console.log(`  #${d.position} — ${d.name}${d.gd_id != null ? ` (gd_id=${d.gd_id})` : ''}`)
      for (const ch of d.changes) {
        const from = ch.from == null || ch.from === '' ? '∅' : JSON.stringify(ch.from)
        const to   = ch.to == null || ch.to === ''   ? '∅' : JSON.stringify(ch.to)
        console.log(`      ${ch.field}: ${from} → ${to}`)
      }
    }
  }
  console.log(`\n${unmatched} sheet rows had no DB match (likely new levels — run \`npm run import\`).`)
  if (permSkipped > 0) {
    console.log(`${permSkipped} matches skipped — owned by permanent records.`)
  }

  if (opts.apply && diffs.length > 0) {
    const update = db.prepare(`
      UPDATE levels SET
        gddl_tier = ?, difficulty = ?, placement_source = ?, points = ?,
        main_skillset = ?, verify_date = ?, verification = ?, verification_url = ?,
        pov_placement = ?, year_verified = ?
      WHERE position = ?
    `)
    db.exec('BEGIN')
    try {
      for (const d of diffs) {
        const sheet = sheetRows.find(
          (s) => (s.gd_id != null && s.gd_id === d.gd_id)
              || (d.gd_id == null && s.name === d.name),
        )
        if (!sheet) continue
        update.run(
          sheet.gddl_tier, sheet.difficulty, sheet.placement_source, sheet.points,
          sheet.main_skillset, sheet.verify_date, sheet.verification, sheet.verification_url,
          sheet.pov_placement, sheet.year_verified,
          d.position,
        )
      }
      db.exec('COMMIT')
      console.log(`\nApplied ${diffs.length} updates to the DB.`)
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } else if (diffs.length > 0) {
    console.log('\nDry run — pass `--apply` to write these changes to the DB.')
  }
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /diff-sheet\.ts$/.test(process.argv[1])
if (isCli) {
  const apply = process.argv.includes('--apply')
  diffSheet({ apply }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

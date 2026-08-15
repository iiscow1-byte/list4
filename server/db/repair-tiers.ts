import { getDb } from './index.ts'
import { TABS, fetchTabRows, findHeaderColumns, refineColumns, resolvePlacementColumn, num, txt } from './import.ts'
import { recomputePoints } from '../utils/points.ts'

/**
 * Repair `gddl_tier` for levels that ended up carrying another level's tier.
 *
 * The importer used to resolve a sheet row to an existing level by name alone
 * when the exact (gd_id, name) key missed. Names collide constantly on this list
 * — 4,595 names are shared by 14,754 levels, and the key lowercases, so "Blight"
 * and "blight" looked like one level — and the Main tab is read first, so a Main
 * row could claim a level sitting thousands of places lower. The claim rewrote
 * the row's name and gd_id but not its tier, which is how a level ends up
 * displaying under one level's identity and the other's tier.
 *
 * The importer no longer makes that match (a name match with two contradicting
 * Level IDs is refused), so this is a one-off repair of rows already written.
 *
 * The sheet is re-read and each level's tier is taken from the row that is
 * unambiguously *its own*: the exact (gd_id, name) key first, then gd_id alone
 * but only when the id appears once on the sheet and once here. Nothing is ever
 * matched on name, which is the mistake being repaired.
 *
 * Run:
 *   npm run repair-tiers              (dry run — lists what would change)
 *   npm run repair-tiers -- --apply
 */

type SheetRow = { gdId: number; name: string; tier: string | null; tab: string }

async function readSheet(): Promise<SheetRow[]> {
  const rows: SheetRow[] = []
  for (const tab of TABS) {
    process.stdout.write(`Fetching "${tab.label}"... `)
    const { text } = await fetchTabRows(tab.gid)
    const found = findHeaderColumns(text)
    if (!found) throw new Error(`tab "${tab.label}" returned no header row — aborting rather than repairing from a partial read.`)
    const c = refineColumns(text, found.cols, found.headerIdx + 1)
    if (resolvePlacementColumn(c) == null) {
      throw new Error(`tab "${tab.label}" has no placement column — aborting rather than repairing from rows that can't be read.`)
    }

    let n = 0
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const name = txt(r[c['level name']!])
      if (!name || num(r[c['placement']!]) === null) continue
      const gdId = num(r[c['level id']!])
      if (gdId == null) continue          // no id, no unambiguous match — skip
      rows.push({ gdId, name, tier: txt(r[c['gddl tier']!]), tab: tab.label })
      n++
    }
    console.log(`${n} row(s)`)
  }
  return rows
}

async function main() {
  const apply = process.argv.includes('--apply')
  const db = getDb()

  const sheet = await readSheet()

  // Sheet-side indexes. The gd_id index is only trusted for ids the sheet lists
  // exactly once — Solo/2P variants share an id, and repairing from an ambiguous
  // id would just swap one wrong tier for another.
  const sheetGdCounts = new Map<number, number>()
  for (const r of sheet) sheetGdCounts.set(r.gdId, (sheetGdCounts.get(r.gdId) ?? 0) + 1)
  const byKey = new Map<string, SheetRow>()
  const byGd = new Map<number, SheetRow>()
  for (const r of sheet) {
    byKey.set(`${r.gdId}|${r.name.toLowerCase()}`, r)
    if (sheetGdCounts.get(r.gdId) === 1) byGd.set(r.gdId, r)
  }

  const levels = db.prepare(
    `SELECT id, position, name, gd_id, gddl_tier FROM levels
      WHERE gd_id IS NOT NULL ORDER BY position ASC`,
  ).all() as { id: number; position: number; name: string; gd_id: number; gddl_tier: string | null }[]

  // Same-caution rule on this side: an id held by two rows here can't be
  // repaired from the id alone either.
  const dbGdCounts = new Map<number, number>()
  for (const l of levels) dbGdCounts.set(l.gd_id, (dbGdCounts.get(l.gd_id) ?? 0) + 1)

  const fixes: { id: number; position: number; name: string; from: string | null; to: string | null; how: string }[] = []
  let matched = 0
  let unmatched = 0

  for (const l of levels) {
    let row = byKey.get(`${l.gd_id}|${l.name.toLowerCase()}`)
    let how = 'gd_id + name'
    if (!row && dbGdCounts.get(l.gd_id) === 1) {
      row = byGd.get(l.gd_id)
      how = 'gd_id (unique both sides)'
    }
    if (!row) { unmatched++; continue }
    matched++
    if ((row.tier ?? null) !== (l.gddl_tier ?? null)) {
      fixes.push({ id: l.id, position: l.position, name: l.name, from: l.gddl_tier, to: row.tier ?? null, how })
    }
  }

  console.log(`\n${levels.length} level(s) with a Level ID.`)
  console.log(`  ${matched} matched to their own sheet row, ${unmatched} not on the sheet (left alone).`)
  console.log(`  ${fixes.length} carry a tier the sheet disagrees with.`)

  if (fixes.length === 0) {
    console.log('\nNothing to repair.')
    return
  }

  console.log('\nFirst 40:')
  for (const f of fixes.slice(0, 40)) {
    console.log(`  #${String(f.position).padStart(6)} "${f.name}": ${f.from ?? '(none)'} -> ${f.to ?? '(none)'}   [${f.how}]`)
  }
  if (fixes.length > 40) console.log(`  … and ${fixes.length - 40} more`)

  if (!apply) {
    console.log(`\nDry run — pass \`-- --apply\` to write ${fixes.length} tier(s).`)
    return
  }

  const upd = db.prepare(`UPDATE levels SET gddl_tier = ? WHERE id = ?`)
  db.exec('BEGIN')
  try {
    for (const f of fixes) upd.run(f.to, f.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  console.log(`\nRepaired ${fixes.length} level tier(s).`)

  // Points are a function of tier and position, so a repaired tier leaves stale
  // points behind it. Recompute rather than leaving the list internally
  // inconsistent until the next import happens to run.
  recomputePoints(db)
  console.log('Points recomputed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

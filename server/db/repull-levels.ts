import { getDb } from './index.ts'
import {
  TABS, fetchTabRows, findHeaderColumns, refineColumns, resolvePlacementColumn,
  extractLinkHref, num, txt,
} from './import.ts'
import { recomputePoints } from '../utils/points.ts'

/**
 * Re-read every sheet-owned field for every level, so the list matches the sheet
 * exactly again.
 *
 * The importer used to resolve a sheet row to an existing level by name alone
 * when the exact (gd_id, name) key missed. Names collide constantly here — 4,595
 * names are shared by 14,754 levels, and the key lowercases, so "Blight" and
 * "blight" read as one level — and the Main tab is read first, so a Main row
 * could claim a level sitting thousands of places lower and overwrite its name
 * and Level ID. Everything else on that row stayed behind, which is how a level
 * ends up wearing one level's identity and another's tier, skillset and
 * verification video.
 *
 * The importer no longer makes that match. This repairs rows already written, by
 * re-reading each level's fields from the row that is unambiguously *its own*:
 * the exact (gd_id, name) key first, then gd_id alone but only when that id
 * appears exactly once on the sheet and exactly once here. Nothing is matched on
 * name — that is the mistake being repaired.
 *
 * Read from the published HTML rather than the CSV export. The CSV is the
 * cleaner grid, but a verification link there is the video's *title*, not its
 * URL — the href only exists in the HTML — and the two views disagree on column
 * indexes anyway, because the HTML collapses the sheet's merged cells.
 *
 * `position` is deliberately untouched: order is the sheet import's job
 * (applySheetOrder), and this is about what each row says, not where it sits.
 *
 * Run:
 *   npm run repull-levels              (dry run — reports what would change)
 *   npm run repull-levels -- --apply
 *   npm run repull-levels -- --apply --fields=gddl_tier,difficulty
 *   npm run repull-levels -- --apply --allow-blanks   (also clear fields the sheet left empty)
 */

/** Sheet-owned columns this refreshes, in report order. */
const FIELDS = [
  'name', 'gddl_tier', 'difficulty', 'placement_source', 'main_skillset',
  'verify_date', 'verification', 'verification_url', 'year_verified',
  'source_tab', 'sheet_placement', 'sheet_rank',
] as const
type Field = (typeof FIELDS)[number]

/** `undefined` = this tab has no such column, so it has no opinion on the field. */
type SheetRow = Record<Field, string | number | null | undefined> & { gdId: number; tab: string }

async function readSheet(): Promise<SheetRow[]> {
  const out: SheetRow[] = []
  for (const tab of TABS) {
    process.stdout.write(`Fetching "${tab.label}"... `)
    const { text, html } = await fetchTabRows(tab.gid)
    const found = findHeaderColumns(text)
    if (!found) {
      throw new Error(`tab "${tab.label}" returned no header row — aborting rather than repulling from a partial read.`)
    }
    const c = refineColumns(text, found.cols, found.headerIdx + 1)
    if (resolvePlacementColumn(c) == null) {
      throw new Error(`tab "${tab.label}" has no placement column — aborting; every row would read as decoration.`)
    }
    const sourceCol = c['source'] ?? c['primary source']
    const verCol = c['verification link']

    let n = 0
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const rh = html[i]!
      const name = txt(r[c['level name']!])
      const placement = num(r[c['placement']!])
      if (!name || placement === null) continue
      const gdId = num(r[c['level id']!])
      // No Level ID means no unambiguous way back to a specific row. Matching
      // those on name is exactly what corrupted the list, so they are skipped.
      if (gdId == null) continue

      /**
       * A column this tab doesn't have is an absence of opinion, not a blank.
       *
       * The tabs are not uniform: "Main Skillset" exists only on the Main tab,
       * "Verification Link" is missing or empty across most of the Subtiers,
       * and no tab carries "Year Verified" at all. Reading a missing column as
       * `null` and writing that back doesn't refresh a level — it erases
       * whatever the field held, for every level on every tab that lacks the
       * column. `undefined` means "this tab says nothing", and the comparison
       * below skips it.
       */
      const col = (key: string) => (c[key] != null ? txt(r[c[key]!]) : undefined)

      out.push({
        gdId,
        tab: tab.label,
        name,
        gddl_tier: col('gddl tier'),
        difficulty: col('difficulty'),
        placement_source: sourceCol != null ? txt(r[sourceCol]) : undefined,
        main_skillset: col('main skillset'),
        verify_date: col('verify date'),
        verification: verCol != null ? txt(r[verCol]) : undefined,
        verification_url: verCol != null ? extractLinkHref(rh[verCol] ?? '') : undefined,
        year_verified: c['year verified'] != null ? num(r[c['year verified']!]) : undefined,
        source_tab: tab.label,
        sheet_placement: placement,
        sheet_rank: placement,
      })
      n++
    }
    console.log(`${n} row(s) with a Level ID`)
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const allowBlanks = process.argv.includes('--allow-blanks')
  const fieldArg = process.argv.find((a) => a.startsWith('--fields='))
  const active: Field[] = fieldArg
    ? fieldArg.slice('--fields='.length).split(',').map((s) => s.trim()).filter((s): s is Field => (FIELDS as readonly string[]).includes(s))
    : [...FIELDS]
  if (active.length === 0) throw new Error(`--fields matched nothing. Known fields: ${FIELDS.join(', ')}`)

  const db = getDb()

  // `sheet_rank` arrived in a later migration than some databases in the wild.
  // Refresh what this table actually has rather than failing the whole repull on
  // a column that isn't there yet.
  const present = new Set(
    (db.prepare(`PRAGMA table_info(levels)`).all() as { name: string }[]).map((r) => r.name),
  )
  const missing = active.filter((f) => !present.has(f))
  const fields = active.filter((f) => present.has(f))
  if (missing.length) console.log(`Skipping column(s) this database doesn't have: ${missing.join(', ')}`)
  if (fields.length === 0) throw new Error('none of the requested fields exist on `levels`')

  const sheet = await readSheet()

  // Sheet-side indexes. The gd_id index is trusted only for ids the sheet lists
  // once — Solo/2P and Old/Unnerfed variants legitimately share an id, and
  // repulling from an ambiguous id would just swap one level's data for another.
  const sheetGdCounts = new Map<number, number>()
  for (const r of sheet) sheetGdCounts.set(r.gdId, (sheetGdCounts.get(r.gdId) ?? 0) + 1)
  const byKey = new Map<string, SheetRow>()
  const byGd = new Map<number, SheetRow>()
  for (const r of sheet) {
    const k = `${r.gdId}|${String(r.name).toLowerCase()}`
    if (!byKey.has(k)) byKey.set(k, r)          // first tab wins, as TABS orders them
    if (sheetGdCounts.get(r.gdId) === 1) byGd.set(r.gdId, r)
  }

  const levels = db.prepare(
    `SELECT id, position, gd_id, ${fields.join(', ')} FROM levels
      WHERE gd_id IS NOT NULL AND (permanent = 0 OR permanent IS NULL)
      ORDER BY position ASC`,
  ).all() as ({ id: number; position: number; gd_id: number } & Record<Field, any>)[]

  // Same caution on this side: an id held by two rows here can't be resolved
  // from the id alone either.
  const dbGdCounts = new Map<number, number>()
  for (const l of levels) dbGdCounts.set(l.gd_id, (dbGdCounts.get(l.gd_id) ?? 0) + 1)

  const changes: { id: number; position: number; name: string; field: Field; from: any; to: any }[] = []
  const perField = new Map<Field, number>(fields.map((f) => [f, 0]))
  const takenSheetRows = new Set<SheetRow>()
  const blanked: typeof changes = []
  let skippedNoColumn = 0
  let matchedExact = 0, matchedGd = 0, unmatched = 0
  const unmatchedSample: string[] = []

  for (const l of levels) {
    let row = byKey.get(`${l.gd_id}|${String(l.name).toLowerCase()}`)
    if (row) matchedExact++
    else if (dbGdCounts.get(l.gd_id) === 1) {
      row = byGd.get(l.gd_id)
      if (row) matchedGd++
    }
    if (!row) {
      unmatched++
      if (unmatchedSample.length < 10) unmatchedSample.push(`#${l.position} "${l.name}" (gd ${l.gd_id})`)
      continue
    }
    takenSheetRows.add(row)

    for (const f of fields) {
      const to = row[f]
      const from = l[f] ?? null

      // The tab carries no such column — it has nothing to say about this
      // field, which is not the same as saying it is empty.
      if (to === undefined) { skippedNoColumn++; continue }

      // Compare as text so 2026 and "2026" don't read as a change every run.
      if (String(from ?? '') === String(to ?? '')) continue

      // The column exists and its cell is empty, but the site has a value. That
      // is usually the sheet being sparse rather than the sheet retracting
      // something — most of these fields are filled in for a minority of rows —
      // so blanking is opt-in.
      if ((to === null || to === '') && from !== null) {
        blanked.push({ id: l.id, position: l.position, name: String(l.name), field: f, from, to: null })
        if (!allowBlanks) continue
      }

      changes.push({ id: l.id, position: l.position, name: String(l.name), field: f, from, to })
      perField.set(f, (perField.get(f) ?? 0) + 1)
    }
  }

  console.log(`\n${levels.length} level(s) with a Level ID.`)
  console.log(`  matched on gd_id + name          : ${matchedExact}`)
  console.log(`  matched on gd_id (unique both)   : ${matchedGd}`)
  console.log(`  not found on the sheet           : ${unmatched}  (left alone)`)
  for (const s of unmatchedSample) console.log(`      ${s}`)
  if (unmatched > unmatchedSample.length) console.log(`      … and ${unmatched - unmatchedSample.length} more`)

  console.log(`\n${changes.length} field(s) differ from the sheet, across ${new Set(changes.map((c) => c.id)).size} level(s):`)
  for (const f of fields) {
    const n = perField.get(f) ?? 0
    if (n) console.log(`  ${f.padEnd(18)} ${n}`)
  }

  if (changes.length === 0) { console.log('\nEverything already matches the sheet.'); return }

  console.log('\nFirst 30 differences:')
  for (const ch of changes.slice(0, 30)) {
    const trim = (v: any) => { const s = v == null ? '(none)' : String(v); return s.length > 52 ? s.slice(0, 49) + '…' : s }
    console.log(`  #${String(ch.position).padStart(6)} "${ch.name}" ${ch.field}: ${trim(ch.from)} -> ${trim(ch.to)}`)
  }
  if (changes.length > 30) console.log(`  … and ${changes.length - 30} more`)

  if (!apply) {
    console.log(`\nDry run — pass \`-- --apply\` to write ${changes.length} field(s).`)
    return
  }

  // One UPDATE per level per field, all inside one transaction.
  const stmts = new Map<Field, ReturnType<typeof db.prepare>>(
    fields.map((f) => [f, db.prepare(`UPDATE levels SET ${f} = ? WHERE id = ?`)]),
  )
  db.exec('BEGIN')
  try {
    for (const ch of changes) stmts.get(ch.field)!.run(ch.to as any, ch.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  console.log(`\nRewrote ${changes.length} field(s).`)

  // Points are a function of tier and position, so a repulled tier leaves stale
  // points behind it.
  if (fields.includes('gddl_tier')) {
    recomputePoints(db)
    console.log('Points recomputed.')
  }
  console.log('Order is unchanged — run `npm run import` if placements also need to move.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

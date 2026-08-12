/**
 * Start the counting over.
 *
 *   npm run reset-analytics                 # dry run: says what it would clear
 *   npm run reset-analytics -- --apply      # actually clear it
 *   npm run reset-analytics -- --apply --rotate-salt
 *   LIST_DB_PATH=/data/list.db npm run reset-analytics -- --apply
 *
 * There is a reason to want this and it is not housekeeping: the counters that
 * exist now were filled by a version that counted wrong. Every arrival at the
 * site scored two views because the homepage redirects; every 404 scored one;
 * every admin tab scored one; and the open beacon endpoint would count the same
 * page fifty times if asked fifty times. Those bugs are fixed, but the totals
 * they produced are still in the tables, and an inflated history makes the
 * corrected present look like a collapse in traffic. Zeroing it draws a line:
 * everything after this is counted by the rules the site now follows.
 *
 * Dry run by default, and it takes a backup before touching anything, because
 * this is not reversible and some of what it clears is *public* — the view count
 * on every level page and in the main list, the number on every custom list, the
 * number on every profile. Those go back to zero for everyone, not just in the
 * admin tab.
 *
 * What it does not touch: the levels, the records, the accounts, the lists, the
 * comments — nothing that anybody wrote. Only counters.
 *
 * Reads LIST_DB_PATH like the rest of the server.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

/**
 * Every table that holds a count, and what it costs to lose it.
 *
 * Written out rather than discovered, so adding a counting table is a decision
 * about whether a reset should clear it rather than something that happens by
 * name-matching. `public` marks the ones a reader can see, which is the part
 * worth being warned about.
 */
const COUNTERS: { table: string; what: string; public?: boolean }[] = [
  { table: 'page_views', what: 'views per page shape, per day' },
  { table: 'page_views_hourly', what: 'views per hour, per day' },
  { table: 'visit_uniques', what: 'daily visitor hashes, and their hour masks' },
  { table: 'account_days', what: 'which accounts were here, and logins' },
  { table: 'level_views', what: 'the view count shown on every level', public: true },
  { table: 'level_view_days', what: 'level views per day' },
  { table: 'profile_views', what: 'the view count shown on every profile', public: true },
  { table: 'custom_list_views', what: 'the view count shown on every custom list', public: true },
  { table: 'custom_list_view_days', what: 'custom list views per day' },
]

const has = (name: string) => process.argv.includes(`--${name}`)
const apply = has('apply')
const rotateSalt = has('rotate-salt')

const DB_PATH = process.env.LIST_DB_PATH || resolve(process.cwd(), 'data', 'list.db')
if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set LIST_DB_PATH or run from the project root.`)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')

/** A table that doesn't exist yet on an older database is not an error. */
function rowsIn(table: string): number | null {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get() as { n: number }).n
  } catch {
    return null
  }
}
function sumIn(table: string, column: string): number | null {
  try {
    return (db.prepare(`SELECT COALESCE(SUM(${quoteIdent(column)}), 0) AS n FROM ${quoteIdent(table)}`)
      .get() as { n: number }).n
  } catch {
    return null
  }
}

const before = COUNTERS.map((c) => ({ ...c, rows: rowsIn(c.table) }))
const totalRows = before.reduce((s, c) => s + (c.rows ?? 0), 0)

const firstDay = (() => {
  try {
    return (db.prepare(`SELECT MIN(day) AS d FROM page_views`).get() as { d: string | null }).d
  } catch { return null }
})()

console.log(`Database:  ${DB_PATH}`)
console.log(`Counting since: ${firstDay ?? 'nothing recorded'}`)
console.log(`Page views recorded: ${(sumIn('page_views', 'views') ?? 0).toLocaleString()}`)
console.log(`Level views recorded: ${(sumIn('level_views', 'views') ?? 0).toLocaleString()}\n`)

console.log('Would clear:')
for (const c of before) {
  const n = c.rows == null ? '   (no table)' : String(c.rows).padStart(12)
  console.log(`  ${n} rows  ${c.table.padEnd(24)} ${c.public ? '· PUBLIC · ' : ''}${c.what}`)
}
console.log(`\n  ${String(totalRows).padStart(12)} rows in total`)

const publicOnes = before.filter((c) => c.public && (c.rows ?? 0) > 0)
if (publicOnes.length) {
  console.log('\nThe counts marked PUBLIC are shown to readers, not only to staff.')
  console.log('After this, every level, list and profile reads 0 views until someone opens it.')
}
if (rotateSalt) {
  console.log('\n--rotate-salt: the visitor salt will be replaced as well, so no hash')
  console.log('produced before this reset could be reproduced even with the database.')
}

if (!apply) {
  console.log('\nDry run — nothing was changed. Re-run with --apply to clear it.')
  process.exit(0)
}

// A snapshot first. VACUUM INTO writes a consistent single file that already
// includes anything sitting in the WAL; copying list.db alone can miss recent
// writes.
const backupDir = join(dirname(DB_PATH), 'backups')
mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = join(backupDir, `list-before-analytics-reset-${stamp}.db`)
db.exec(`VACUUM INTO ${quote(backupPath)}`)
console.log(`\nBackup written: ${backupPath}`)

db.exec('BEGIN')
let cleared = 0
try {
  // `before`, not COUNTERS: only `before` carries the row counts, and a table
  // that doesn't exist on an older database has `rows === null`.
  for (const c of before) {
    if (c.rows == null) continue
    cleared += db.prepare(`DELETE FROM ${quoteIdent(c.table)}`).run().changes as number
  }
  if (rotateSalt) db.prepare(`DELETE FROM site_meta WHERE key = 'visitor_salt'`).run()
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  console.error('\nReset failed, rolled back. The database is unchanged.')
  throw e
}

const after = COUNTERS.map((c) => ({ table: c.table, rows: rowsIn(c.table) }))
const leftOver = after.filter((c) => (c.rows ?? 0) > 0)

console.log(`Cleared ${cleared.toLocaleString()} row(s) across ${COUNTERS.length} tables.`)
if (leftOver.length) {
  console.error('Still not empty:', leftOver.map((c) => `${c.table}=${c.rows}`).join(', '))
  process.exitCode = 1
} else {
  console.log('Every counter is at zero. Counting restarts with the next page anybody opens.')
}
console.log(`Restore with:  cp ${backupPath} ${DB_PATH}`)

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
/** Table and column names are from the list above, but never interpolate raw. */
function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

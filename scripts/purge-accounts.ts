/**
 * Delete accounts created on or after a cutoff date.
 *
 *   npm run purge-accounts                      # dry run, default cutoff
 *   npm run purge-accounts -- --apply           # actually delete
 *   npm run purge-accounts -- --cutoff=2026-07-30
 *   npm run purge-accounts -- --apply --include-staff
 *
 * Dry run by default, because this is not reversible and the blast radius is
 * wider than "some accounts": deleting one takes its custom lists, progress
 * posts, comments, follows and inbox with it. The dry run prints that radius
 * from the live schema before anything happens.
 *
 * Staff accounts are kept unless `--include-staff` is passed. With sign-ups
 * closed and the site locked to staff, deleting the last admin locks everyone
 * out of their own site permanently — so that needs to be asked for, not
 * arrived at. `scripts/make-admin.ts` is the way back in if it happens anyway.
 *
 * Reads LIST_DB_PATH like the rest of the server.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

/** Accounts created on or after this date go. "After 7/29" = from 7/30 on. */
const DEFAULT_CUTOFF = '2026-07-30'
const STAFF_ROLES = ['admin', 'owner', 'developer']

function arg(name: string): string | undefined {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')) {
    return process.argv[i + 1]
  }
  return undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

const cutoff = arg('cutoff') ?? DEFAULT_CUTOFF
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
  console.error('--cutoff must be YYYY-MM-DD')
  process.exit(1)
}
const apply = has('apply')
const includeStaff = has('include-staff')

const DB_PATH = process.env.LIST_DB_PATH || resolve(process.cwd(), 'data', 'list.db')
if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set LIST_DB_PATH or run from the project root.`)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

type AccountRow = { id: number; username: string; role: string; created_at: string }

// `created_at` is `datetime('now')` → "YYYY-MM-DD HH:MM:SS", so a plain string
// compare against a bare date is a correct "on or after midnight" test.
const roleFilter = includeStaff
  ? ''
  : ` AND role NOT IN (${STAFF_ROLES.map(() => '?').join(',')})`
const params: unknown[] = [cutoff, ...(includeStaff ? [] : STAFF_ROLES)]

const doomed = db.prepare(
  `SELECT id, username, role, created_at FROM accounts
    WHERE created_at >= ?${roleFilter}
    ORDER BY created_at ASC`,
).all(...params) as AccountRow[]

const spared = db.prepare(
  `SELECT id, username, role, created_at FROM accounts
    WHERE created_at >= ? AND role IN (${STAFF_ROLES.map(() => '?').join(',')})
    ORDER BY created_at ASC`,
).all(cutoff, ...STAFF_ROLES) as AccountRow[]

const total = (db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n

console.log(`Database:  ${DB_PATH}`)
console.log(`Cutoff:    created on or after ${cutoff} (i.e. after ${prevDay(cutoff)})`)
console.log(`Accounts:  ${total} total, ${doomed.length} matched\n`)

if (!doomed.length) {
  console.log('Nothing to delete.')
  if (spared.length && !includeStaff) {
    console.log(`\n${spared.length} staff account(s) match the cutoff but are protected:`)
    for (const a of spared) console.log(`  ${a.role.padEnd(10)} ${a.username}  (${a.created_at})`)
    console.log('Pass --include-staff to delete these too.')
  }
  process.exit(0)
}

// ---- Blast radius, read from the schema rather than assumed ----
type FkRow = { table: string; from: string; on_delete: string }
const tables = (db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
).all() as { name: string }[]).map((r) => r.name)

const cascades: FkRow[] = []
const nulled: FkRow[] = []
for (const table of tables) {
  const fks = db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all() as {
    table: string; from: string; on_delete: string
  }[]
  for (const fk of fks) {
    if (fk.table !== 'accounts') continue
    const row = { table, from: fk.from, on_delete: fk.on_delete }
    if (fk.on_delete === 'CASCADE') cascades.push(row)
    else nulled.push(row)
  }
}

const ids = doomed.map((a) => a.id)
const placeholders = ids.map(() => '?').join(',')
function countIn(table: string, column: string): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM ${JSON.stringify(table)} WHERE ${JSON.stringify(column)} IN (${placeholders})`,
  ).get(...ids) as { n: number }).n
}

console.log(`Accounts to delete (${doomed.length}):`)
for (const a of doomed.slice(0, 50)) {
  console.log(`  ${String(a.id).padStart(5)}  ${a.username.padEnd(24)} ${a.role.padEnd(10)} ${a.created_at}`)
}
if (doomed.length > 50) console.log(`  … and ${doomed.length - 50} more`)

const cascadeCounts = cascades
  .map((fk) => ({ ...fk, n: countIn(fk.table, fk.from) }))
  .filter((r) => r.n > 0)
  .sort((a, b) => b.n - a.n)
if (cascadeCounts.length) {
  console.log('\nRows deleted with them (ON DELETE CASCADE):')
  for (const r of cascadeCounts) console.log(`  ${String(r.n).padStart(7)}  ${r.table}.${r.from}`)
} else {
  console.log('\nNo dependent rows will be deleted.')
}

const nullCounts = nulled
  .map((fk) => ({ ...fk, n: countIn(fk.table, fk.from) }))
  .filter((r) => r.n > 0)
  .sort((a, b) => b.n - a.n)
if (nullCounts.length) {
  console.log('\nRows kept, attribution cleared (ON DELETE SET NULL):')
  for (const r of nullCounts) console.log(`  ${String(r.n).padStart(7)}  ${r.table}.${r.from}`)
}

if (spared.length && !includeStaff) {
  console.log(`\nProtected — match the cutoff but are staff (${spared.length}):`)
  for (const a of spared) console.log(`  ${a.role.padEnd(10)} ${a.username}  (${a.created_at})`)
  console.log('Pass --include-staff to delete these too.')
}

if (!apply) {
  console.log('\nDry run — nothing was changed. Re-run with --apply to delete.')
  process.exit(0)
}

// ---- Guard: don't leave the site with no way in ----
const staffAfter = (db.prepare(
  `SELECT COUNT(*) AS n FROM accounts
    WHERE role IN (${STAFF_ROLES.map(() => '?').join(',')})
      AND id NOT IN (${placeholders})`,
).get(...STAFF_ROLES, ...ids) as { n: number }).n

if (staffAfter === 0 && !has('force')) {
  console.error('\nRefusing: this would leave zero admin accounts.')
  console.error('With sign-ups closed and the site locked to staff, nobody could sign in.')
  console.error("Create an admin first (npm run make-admin -- --username <name> --password '<pw>'),")
  console.error('or pass --force if you really mean to.')
  process.exit(1)
}

// ---- Backup, then delete ----
// VACUUM INTO writes a consistent single-file snapshot that already includes
// anything sitting in the WAL — copying list.db alone can miss recent writes.
const backupDir = join(dirname(DB_PATH), 'backups')
mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = join(backupDir, `list-before-purge-${stamp}.db`)
db.exec(`VACUUM INTO ${quote(backupPath)}`)
console.log(`\nBackup written: ${backupPath}`)

db.exec('BEGIN')
let deleted = 0
try {
  const del = db.prepare(`DELETE FROM accounts WHERE id = ?`)
  for (const a of doomed) deleted += del.run(a.id).changes
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  console.error('\nDelete failed, rolled back. The database is unchanged.')
  throw e
}

const remaining = (db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n
console.log(`Deleted ${deleted} account(s). ${remaining} remain.`)
console.log(`Restore with:  cp ${backupPath} ${DB_PATH}`)

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** The day before a YYYY-MM-DD date, for readable output. */
function prevDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

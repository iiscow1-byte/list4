import { getDb } from './index.ts'

/**
 * One-time fix: delete non-permanent rows from `levels` that have no records
 * attached. Use when a bad sheet import polluted the table and a clean
 * re-import is the easiest path. Levels with records (permanent or not) are
 * left alone so attached records aren't orphaned.
 *
 * Run:
 *   npm run clear-temporary-levels        (dry run — reports what would change)
 *   npm run clear-temporary-levels -- --apply
 */

const TARGET_WHERE = `
  (permanent IS NULL OR permanent = 0)
  AND NOT EXISTS (SELECT 1 FROM records r WHERE r.level_id = levels.id)
`

async function main() {
  const apply = process.argv.includes('--apply')
  const db = getDb()

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM levels`).get() as { n: number }).n
  const tempCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM levels WHERE permanent IS NULL OR permanent = 0`,
  ).get() as { n: number }).n
  const skipCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM levels
     WHERE (permanent IS NULL OR permanent = 0)
       AND EXISTS (SELECT 1 FROM records r WHERE r.level_id = levels.id)`,
  ).get() as { n: number }).n
  const targetCount = (db.prepare(`SELECT COUNT(*) AS n FROM levels WHERE ${TARGET_WHERE}`).get() as { n: number }).n
  const permCount = total - tempCount

  console.log(`levels: ${total} total — ${permCount} permanent, ${tempCount} temporary.`)
  console.log(`  ${skipCount} temporary rows kept (have attached records).`)
  console.log(`  ${targetCount} temporary rows would be deleted.`)

  if (targetCount === 0) {
    console.log('\nNothing to clear.')
    return
  }

  if (!apply) {
    console.log(`\nDry run — pass \`-- --apply\` to delete ${targetCount} rows.`)
    return
  }

  db.exec('BEGIN')
  try {
    const res = db.prepare(`DELETE FROM levels WHERE ${TARGET_WHERE}`).run()
    console.log(`Deleted ${res.changes} rows from levels.`)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

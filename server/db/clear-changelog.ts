import { getDb } from './index.ts'

/**
 * Delete changelog entries dated after a given day.
 *
 * The changelog is two tables, and the page reads both — clearing one and not
 * the other leaves half the entries on screen:
 *   - `position_history`  every move and addition, one row per level per change
 *   - `level_removals`    every level taken off the list
 *
 * Dates are compared with SQLite's `date()` on the stored timestamp, which is
 * `datetime('now')` — UTC, `YYYY-MM-DD HH:MM:SS`. "After 2026-08-13" therefore
 * means the 14th onward; the 13th itself is kept. That is the reading of "clear
 * everything after the 13th" that doesn't quietly take a day more than asked.
 *
 * `position_history` also carries a `source` ('all' for this list, 'aredl' and
 * friends for mirrored lists). All sources go unless `--source=` narrows it,
 * because the changelog shows them together.
 *
 * This is not undoable and there is no backup step, so it dry-runs by default
 * and prints the damage per day before it will touch anything.
 *
 * Run:
 *   npm run clear-changelog -- --after=2026-08-13
 *   npm run clear-changelog -- --after=2026-08-13 --apply
 *   npm run clear-changelog -- --after=2026-08-13 --apply --source=all
 */

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const after = arg('after')
  const source = arg('source')

  if (!after || !/^\d{4}-\d{2}-\d{2}$/.test(after)) {
    throw new Error('pass --after=YYYY-MM-DD (entries dated strictly after this day are deleted)')
  }

  const db = getDb()

  // `level_removals` arrived in a later migration than some databases in the
  // wild; a changelog clear shouldn't fail on a table that isn't there yet.
  const hasRemovals = db.prepare(
    `SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'level_removals'`,
  ).get() != null

  const srcWhere = source ? ` AND source = ?` : ''
  const srcParams = source ? [source] : []

  const moveRows = db.prepare(
    `SELECT date(changed_at) AS d, source, COUNT(*) AS n
       FROM position_history
      WHERE date(changed_at) > date(?)${srcWhere}
      GROUP BY d, source ORDER BY d ASC`,
  ).all(after, ...srcParams) as { d: string; source: string; n: number }[]

  const removalRows = hasRemovals
    ? (db.prepare(
        `SELECT date(removed_at) AS d, COUNT(*) AS n
           FROM level_removals
          WHERE date(removed_at) > date(?)
          GROUP BY d ORDER BY d ASC`,
      ).all(after) as { d: string; n: number }[])
    : []

  const moves = moveRows.reduce((a, r) => a + r.n, 0)
  const removals = removalRows.reduce((a, r) => a + r.n, 0)

  console.log(`Changelog entries dated after ${after}${source ? ` (source='${source}')` : ''}:`)
  console.log(`  position_history : ${moves}`)
  console.log(`  level_removals   : ${hasRemovals ? removals : '(table not present)'}`)

  if (moves + removals === 0) { console.log('\nNothing to clear.'); return }

  console.log('\nBy day:')
  const byDay = new Map<string, { moves: number; removals: number; sources: Set<string> }>()
  for (const r of moveRows) {
    const e = byDay.get(r.d) ?? { moves: 0, removals: 0, sources: new Set<string>() }
    e.moves += r.n; e.sources.add(r.source); byDay.set(r.d, e)
  }
  for (const r of removalRows) {
    const e = byDay.get(r.d) ?? { moves: 0, removals: 0, sources: new Set<string>() }
    e.removals += r.n; byDay.set(r.d, e)
  }
  for (const [d, e] of [...byDay.entries()].sort()) {
    console.log(
      `  ${d}  ${String(e.moves).padStart(7)} move(s)` +
      `  ${String(e.removals).padStart(5)} removal(s)` +
      `   [${[...e.sources].sort().join(', ') || '-'}]`,
    )
  }

  // What survives, so the run can be sanity-checked against the page afterwards.
  const keptMoves = (db.prepare(
    `SELECT COUNT(*) AS n FROM position_history WHERE date(changed_at) <= date(?)`,
  ).get(after) as { n: number }).n
  console.log(`\n${keptMoves} position_history row(s) dated ${after} or earlier are kept.`)

  if (!apply) {
    console.log(`\nDry run — pass \`-- --apply\` to delete ${moves + removals} entr(ies). This cannot be undone.`)
    return
  }

  db.exec('BEGIN')
  try {
    const m = db.prepare(
      `DELETE FROM position_history WHERE date(changed_at) > date(?)${srcWhere}`,
    ).run(after, ...srcParams)
    let r = { changes: 0 }
    if (hasRemovals) {
      r = db.prepare(`DELETE FROM level_removals WHERE date(removed_at) > date(?)`).run(after) as any
    }
    db.exec('COMMIT')
    console.log(`\nDeleted ${m.changes} position_history row(s) and ${r.changes} level_removals row(s).`)
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  console.log('The changelog page reads these tables directly — no cache to clear.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

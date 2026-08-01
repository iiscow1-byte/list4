import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Downloadable reconciliation report between the ALL sheet and this site.
 *
 * Four sections, because "the sheet and the site disagree" has distinct shapes
 * and lumping them together hides which one you're looking at:
 *
 *   1. Offset runs — stretches of the list where the sheet's number is a
 *      constant N ahead of this site's own row order. This is the section that
 *      actually answers "where did the two lists diverge".
 *   2. Drift points — the first level of each run, i.e. exactly where the
 *      offset changed and by how much.
 *   3. Site-only levels — nothing on the sheet carries this level's ID. Flagged
 *      by the sheet import (`levels.site_only`), not inferred here.
 *   4. Sheet-exclusive rows — the sheet had the row, the import read it, and no
 *      level here represents it. Recorded by the import with the sheet's own
 *      data, since after the fact there is nothing left to reconstruct it from.
 *
 * The per-level mismatch list is deliberately *not* included by default. An
 * offset introduced at #304 makes every one of the 53,000 levels below it
 * "mismatch", so the raw list is ten megabytes that all say the same thing.
 * Pass `?full=1` for it anyway; the runs above are the readable version.
 *
 * `?format=csv` returns the drift points as a spreadsheet, or with `full=1`
 * every mismatching level.
 */

type Mismatch = {
  level_id: number
  gd_id: number | null
  name: string
  sheet_placement: number
  site_placement: number
  difference: number
  gddl_tier: string | null
  verifier: string | null
  source_tab: string | null
}

type OffsetRun = {
  difference: number
  from_site_placement: number
  to_site_placement: number
  levels: number
  starts_at: { name: string; gd_id: number | null; sheet_placement: number; site_placement: number }
}

/**
 * Every level that carries a sheet number, in list order, with the site's own
 * placement alongside.
 *
 * The site placement is the level's *rank* in list order, not `position`
 * itself: positions carry gaps from past deletes, so comparing raw values would
 * report drift that isn't there.
 */
function buildMismatchRows(db: ReturnType<typeof getDb>): Mismatch[] {
  return db
    .prepare(
      `SELECT level_id, gd_id, name, sheet_placement, site_placement,
              (sheet_placement - site_placement) AS difference,
              gddl_tier, verifier, source_tab
         FROM (
           SELECT id AS level_id, gd_id, name, sheet_placement, gddl_tier, verifier, source_tab,
                  ROW_NUMBER() OVER (ORDER BY position ASC) AS site_placement
             FROM levels
         )
        WHERE sheet_placement IS NOT NULL
        ORDER BY site_placement ASC`,
    )
    .all() as Mismatch[]
}

/** Collapse consecutive levels sharing an offset into one run. */
function buildOffsetRuns(rows: Mismatch[]): OffsetRun[] {
  const runs: OffsetRun[] = []
  for (const r of rows) {
    const last = runs[runs.length - 1]
    if (last && last.difference === r.difference) {
      last.to_site_placement = r.site_placement
      last.levels++
      continue
    }
    runs.push({
      difference: r.difference,
      from_site_placement: r.site_placement,
      to_site_placement: r.site_placement,
      levels: 1,
      starts_at: {
        name: r.name,
        gd_id: r.gd_id,
        sheet_placement: r.sheet_placement,
        site_placement: r.site_placement,
      },
    })
  }
  return runs
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Leading =, +, - or @ make spreadsheet apps evaluate the cell as a formula.
  // Level names are user/curator text, so prefix those with a quote.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(',')]
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','))
  return lines.join('\r\n')
}

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const q = getQuery(event)
  const format = String(q.format ?? 'json').toLowerCase()
  const full = q.full === '1' || q.full === 'true'

  const rows = buildMismatchRows(db)
  const mismatches = rows.filter((r) => r.difference !== 0)
  const runs = buildOffsetRuns(rows)
  // The first run is the list's starting state, not a change; every run after
  // it begins at a level where the offset moved.
  const driftPoints = runs.slice(1).map((run, i) => ({
    site_placement: run.starts_at.site_placement,
    sheet_placement: run.starts_at.sheet_placement,
    name: run.starts_at.name,
    gd_id: run.starts_at.gd_id,
    difference: run.difference,
    // Positive = the sheet pulled further ahead here (a level exists on the
    // sheet that has no row here). Negative = the reverse.
    shift: run.difference - runs[i]!.difference,
    levels_in_run: run.levels,
  }))

  const stamp = new Date().toISOString().slice(0, 10)

  if (format === 'csv') {
    if (full) {
      const columns = [
        'site_placement', 'sheet_placement', 'difference', 'name', 'gd_id',
        'gddl_tier', 'verifier', 'source_tab', 'level_id',
      ]
      setHeader(event, 'content-type', 'text/csv; charset=utf-8')
      setHeader(event, 'content-disposition', `attachment; filename="all-placement-mismatches-${stamp}.csv"`)
      return toCsv(mismatches as unknown as Record<string, unknown>[], columns)
    }
    const columns = ['site_placement', 'sheet_placement', 'difference', 'shift', 'levels_in_run', 'name', 'gd_id']
    setHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="all-placement-drift-${stamp}.csv"`)
    return toCsv(driftPoints as unknown as Record<string, unknown>[], columns)
  }

  const siteOnly = db
    .prepare(
      `SELECT id AS level_id, position, sheet_placement, gd_id, name, gddl_tier, difficulty,
              verifier, verify_date, verification_url, placement_source, source_tab,
              submitted_by, permanent
         FROM levels
        WHERE COALESCE(site_only, 0) = 1
        ORDER BY position ASC`,
    )
    .all()

  const sheetExclusive = db
    .prepare(
      `SELECT gd_id, name, sheet_placement, gddl_tier, difficulty, verifier, verify_date,
              verification_url, source_tab, placement_source, reason, imported_at
         FROM sheet_exclusive_levels
        ORDER BY sheet_placement ASC`,
    )
    .all()

  const recordedAt = (db
    .prepare(`SELECT MAX(imported_at) AS at FROM sheet_exclusive_levels`)
    .get() as { at: string | null }).at

  const totalLevels = (db.prepare(`SELECT COUNT(*) AS n FROM levels`).get() as { n: number }).n

  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="all-sheet-report-${stamp}.json"`)
  return {
    generated_at: new Date().toISOString(),
    // Null carries real ambiguity, so say so rather than letting an empty
    // section read as a clean bill of health.
    sheet_exclusive_recorded_at: recordedAt,
    notes: {
      offset_runs:
        'Stretches of the list where the sheet number is a constant amount ahead of this site\'s row order. difference = sheet - site.',
      drift_points:
        'The level at which each offset run begins — where the two numberings moved apart, and by how much (shift).',
      site_only_levels:
        'Levels here whose ID appears nowhere on the ALL sheet. Set by the sheet import.',
      sheet_exclusive_levels: recordedAt
        ? 'Sheet rows the last import read but did not represent as a level here, with the sheet\'s own data.'
        : 'Nothing on file. Either the last import found no such rows, or no ALL sheet import has run since this report was added.',
      placement_mismatches: full
        ? 'Every level whose sheet number differs from its site placement.'
        : 'Omitted — an offset near the top of the list makes almost every level below it differ by the same amount. Re-request with ?full=1 for the per-level list.',
    },
    totals: {
      levels: totalLevels,
      levels_with_sheet_number: rows.length,
      placement_mismatches: mismatches.length,
      offset_runs: runs.length,
      drift_points: driftPoints.length,
      site_only: siteOnly.length,
      sheet_exclusive: sheetExclusive.length,
    },
    offset_runs: runs,
    drift_points: driftPoints,
    ...(full ? { placement_mismatches: mismatches } : {}),
    site_only_levels: siteOnly,
    sheet_exclusive_levels: sheetExclusive,
  }
})

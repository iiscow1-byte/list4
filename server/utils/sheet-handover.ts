import type { DatabaseSync } from 'node:sqlite'

/**
 * Handing a level back to the sheet.
 *
 * A level can be here in two ways. Most are the sheet's: the importer owns the
 * row, refreshes it on every run, and renumbers it into the sheet's order.
 * Some are the *site's* — promoted submissions, AREDL promotions, hand-placed
 * additions. Those carry `permanent = 1` (the importer skips them entirely) or
 * `site_only = 1` (no sheet row anywhere carries their ID), and everything
 * about them is whatever was typed here.
 *
 * That second kind is meant to be temporary. Once the curators put the level on
 * the sheet, the site's copy stops being the record and starts being a stale
 * duplicate of it — which is what `sheet_exclusive_levels` has been quietly
 * reporting after every import: "the sheet describes this level and nothing
 * here represents it". Handing over resolves that: take the sheet's data, drop
 * the site's ownership, and let the importer have the row from now on.
 *
 * The reverse is not offered. Turning a sheet row into a site-owned one is what
 * `permanent` already means, and doing it by hand would silently freeze a level
 * against every future import.
 */

export type HandoverCandidate = {
  level_id: number
  position: number
  name: string
  gd_id: number | null
  /** Why the site owns it. */
  reason: 'permanent' | 'site_only' | 'both'
  /** The sheet row that would take over, when there is one. */
  sheet: {
    name: string
    sheet_placement: number | null
    gddl_tier: string | null
    difficulty: string | null
    verifier: string | null
    verify_date: string | null
    verification_url: string | null
    source_tab: string | null
    placement_source: string | null
  } | null
}

const SHEET_COLS = `
  name, sheet_placement, gddl_tier, difficulty, verifier, verify_date,
  verification_url, source_tab, placement_source
`

/**
 * Levels the site owns, each paired with the sheet row that could take over.
 *
 * The pairing is by GD id, which is the only identifier the two sides agree on.
 * A level with no `gd_id` can never be matched and is reported with
 * `sheet: null` — visible, because "the sheet can't claim this one" is the
 * answer, not an omission.
 */
export function handoverCandidates(db: DatabaseSync): HandoverCandidate[] {
  const rows = db.prepare(
    `SELECT id AS level_id, position, name, gd_id,
            COALESCE(permanent, 0) AS permanent, COALESCE(site_only, 0) AS site_only
       FROM levels
      WHERE COALESCE(permanent, 0) = 1 OR COALESCE(site_only, 0) = 1
      ORDER BY position ASC`,
  ).all() as Array<{
    level_id: number; position: number; name: string; gd_id: number | null
    permanent: number; site_only: number
  }>
  if (!rows.length) return []

  const findSheet = db.prepare(
    `SELECT ${SHEET_COLS} FROM sheet_exclusive_levels WHERE gd_id = ? LIMIT 1`,
  )

  return rows.map((r) => ({
    level_id: r.level_id,
    position: r.position,
    name: r.name,
    gd_id: r.gd_id,
    reason: r.permanent && r.site_only ? 'both' : r.permanent ? 'permanent' : 'site_only',
    sheet: r.gd_id == null
      ? null
      : (findSheet.get(r.gd_id) as HandoverCandidate['sheet']) ?? null,
  }))
}

export type HandoverResult = {
  level_id: number
  name: string
  handed_over: boolean
  /** Set when nothing happened. */
  reason?: string
}

/**
 * Give one level to the sheet.
 *
 * Copies the sheet's data over the site's, clears both ownership flags, and
 * removes the sheet-exclusive record the pair was reported through. The level
 * keeps its position: the sheet's ordering is applied by the next import, or by
 * "Reset to the sheet's order" — both of which know where every *other* level
 * goes too, which moving one level here on its own would only guess at.
 *
 * Fields the sheet leaves blank do not overwrite what's here: the sheet not
 * having a verifier is not the same as the sheet saying there isn't one.
 */
export function handOverToSheet(db: DatabaseSync, levelId: number): HandoverResult {
  const level = db.prepare(
    `SELECT id, name, gd_id, COALESCE(permanent, 0) AS permanent, COALESCE(site_only, 0) AS site_only
       FROM levels WHERE id = ?`,
  ).get(levelId) as
    { id: number; name: string; gd_id: number | null; permanent: number; site_only: number } | undefined
  if (!level) return { level_id: levelId, name: `#${levelId}`, handed_over: false, reason: 'No such level.' }
  if (!level.permanent && !level.site_only) {
    return { level_id: levelId, name: level.name, handed_over: false, reason: 'Already the sheet\'s.' }
  }

  const sheet = level.gd_id == null
    ? null
    : (db.prepare(`SELECT ${SHEET_COLS} FROM sheet_exclusive_levels WHERE gd_id = ? LIMIT 1`)
        .get(level.gd_id) as HandoverCandidate['sheet']) ?? null

  db.exec('BEGIN')
  try {
    if (sheet) {
      // `sheet_rank` takes the sheet's number; `sheet_placement` does not.
      //
      // The two are the same number and answer different questions. Placement
      // is what the *slot* prints, and it has to climb as you read down the
      // list — writing the sheet's 12,345 onto a level currently sitting at
      // position 300 would put a "#12345" between #299 and #301. Rank is the
      // sheet's opinion of where the level goes, which is exactly what "Reset
      // to the sheet's order" and the next import read to actually move it.
      db.prepare(
        `UPDATE levels
            SET name             = COALESCE(NULLIF(?, ''), name),
                sheet_rank       = COALESCE(?, sheet_rank),
                gddl_tier        = COALESCE(NULLIF(?, ''), gddl_tier),
                difficulty       = COALESCE(NULLIF(?, ''), difficulty),
                verifier         = COALESCE(NULLIF(?, ''), verifier),
                verify_date      = COALESCE(NULLIF(?, ''), verify_date),
                verification_url = COALESCE(NULLIF(?, ''), verification_url),
                source_tab       = COALESCE(NULLIF(?, ''), source_tab),
                placement_source = COALESCE(NULLIF(?, ''), placement_source),
                permanent        = 0,
                site_only        = 0
          WHERE id = ?`,
      ).run(
        sheet.name, sheet.sheet_placement,
        sheet.gddl_tier, sheet.difficulty, sheet.verifier, sheet.verify_date,
        sheet.verification_url, sheet.source_tab, sheet.placement_source,
        levelId,
      )
      db.prepare(`DELETE FROM sheet_exclusive_levels WHERE gd_id = ?`).run(level.gd_id)
    } else {
      // No sheet row yet. Dropping `permanent` is still the whole point: the
      // importer has been skipping this level, and now it won't — so the next
      // run picks it up the moment the curators add it.
      db.prepare(`UPDATE levels SET permanent = 0 WHERE id = ?`).run(levelId)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { level_id: levelId, name: sheet?.name ?? level.name, handed_over: true }
}

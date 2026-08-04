import type { DatabaseSync } from 'node:sqlite'
import { buildLevelSliceWhere, type LevelSliceFilter } from './level-slice'

/**
 * Reading rows out of any list the site imports.
 *
 * The ALL list is one option among many: every mirror (AREDL, GDL, MSCL, and
 * each GDListTemplate list such as CCL) is already stored as an ordered set of
 * levels, which is exactly what a custom list is. The catalogue of what those
 * sources *are* lives in `~/utils/list-source-catalog` so the admin picker can
 * render from the same list this validates against.
 */
export { isKnownSource, sourceLabel, sourceShortLabel, LIST_SOURCES } from '~/utils/list-source-catalog'

export type SourceRow = {
  /** 1-based rank on the source list. */
  position: number
  /** What the UI shows as the placement — the sheet's number for the ALL. */
  display_position: number
  name: string
  gd_id: number | null
  creator: string | null
  verifier: string | null
  verification_url: string | null
  gddl_tier: string | null
  /** Set only for the ALL list, where a custom item can link to `levels.id`. */
  level_id: number | null
}

/**
 * Rows from `source` inside the `from_position`..`to_position` window, in list
 * order. For the ALL list the window is a position range with the optional
 * tier / rating filters applied; for a mirror it's a plain rank range, since
 * those tables carry no ALL tier data of their own.
 */
export function loadSourceRows(
  db: DatabaseSync,
  source: string,
  filter: LevelSliceFilter,
  limit: number,
): SourceRow[] {
  const from = Number(filter?.from_position)
  const to = Number(filter?.to_position)
  const lo = Number.isInteger(from) && from > 0 ? from : 1
  const hi = Number.isInteger(to) && to > 0 ? to : Number.MAX_SAFE_INTEGER

  if (source === 'all') {
    const { where, params } = buildLevelSliceWhere(filter)
    return db.prepare(
      `SELECT id AS level_id, position, COALESCE(sheet_placement, position) AS display_position,
              name, gd_id, creator, verifier, verification_url, gddl_tier
         FROM levels ${where}
        ORDER BY position ASC
        LIMIT ?`,
    ).all(...params, limit) as SourceRow[]
  }

  if (source === 'aredl') {
    return db.prepare(
      `SELECT NULL AS level_id, position, position AS display_position, name, gd_id,
              publisher_name AS creator, verifier_name AS verifier,
              verification_url, NULL AS gddl_tier
         FROM aredl_levels
        WHERE legacy = 0 AND position BETWEEN ? AND ?
        ORDER BY position ASC
        LIMIT ?`,
    ).all(lo, hi, limit) as SourceRow[]
  }

  if (source === 'gdl') {
    return db.prepare(
      `SELECT NULL AS level_id, placement AS position, placement AS display_position, name, gd_id,
              creator, verifier_name AS verifier, verification_url, NULL AS gddl_tier
         FROM gdl_levels
        WHERE placement BETWEEN ? AND ?
        ORDER BY placement ASC
        LIMIT ?`,
    ).all(lo, hi, limit) as SourceRow[]
  }

  if (source === 'mscl') {
    return db.prepare(
      `SELECT NULL AS level_id, position, position AS display_position, name, gd_id,
              publisher_name AS creator, verifier_name AS verifier,
              video AS verification_url, NULL AS gddl_tier
         FROM mscl_levels
        WHERE position BETWEEN ? AND ?
        ORDER BY position ASC
        LIMIT ?`,
    ).all(lo, hi, limit) as SourceRow[]
  }

  if (source === 'acs') {
    return db.prepare(
      `SELECT NULL AS level_id, position, position AS display_position, name, gd_id,
              NULL AS creator, NULL AS verifier, NULL AS verification_url, NULL AS gddl_tier
         FROM acs_levels
        WHERE tab = 'extreme' AND position BETWEEN ? AND ?
        ORDER BY position ASC
        LIMIT ?`,
    ).all(lo, hi, limit) as SourceRow[]
  }

  if (source.startsWith('gdtpl:')) {
    const slug = source.slice('gdtpl:'.length)
    return db.prepare(
      `SELECT NULL AS level_id, position, position AS display_position,
              COALESCE(name, level_slug) AS name, gd_id,
              author AS creator, verifier, verification_url, NULL AS gddl_tier
         FROM gdtpl_levels
        WHERE list_slug = ? AND position BETWEEN ? AND ?
        ORDER BY position ASC
        LIMIT ?`,
    ).all(slug, lo, hi, limit) as SourceRow[]
  }

  return []
}

/** How many rows the same filter matches, before `limit` is applied. */
export function countSourceRows(
  db: DatabaseSync,
  source: string,
  filter: LevelSliceFilter,
): number {
  const from = Number(filter?.from_position)
  const to = Number(filter?.to_position)
  const lo = Number.isInteger(from) && from > 0 ? from : 1
  const hi = Number.isInteger(to) && to > 0 ? to : Number.MAX_SAFE_INTEGER

  if (source === 'all') {
    const { where, params } = buildLevelSliceWhere(filter)
    return (db.prepare(`SELECT COUNT(*) AS n FROM levels ${where}`)
      .get(...params) as { n: number }).n
  }
  if (source === 'aredl') {
    return (db.prepare(
      `SELECT COUNT(*) AS n FROM aredl_levels WHERE legacy = 0 AND position BETWEEN ? AND ?`,
    ).get(lo, hi) as { n: number }).n
  }
  if (source === 'gdl') {
    return (db.prepare(
      `SELECT COUNT(*) AS n FROM gdl_levels WHERE placement BETWEEN ? AND ?`,
    ).get(lo, hi) as { n: number }).n
  }
  if (source === 'mscl') {
    return (db.prepare(
      `SELECT COUNT(*) AS n FROM mscl_levels WHERE position BETWEEN ? AND ?`,
    ).get(lo, hi) as { n: number }).n
  }
  if (source === 'acs') {
    return (db.prepare(
      `SELECT COUNT(*) AS n FROM acs_levels WHERE tab = 'extreme' AND position BETWEEN ? AND ?`,
    ).get(lo, hi) as { n: number }).n
  }
  if (source.startsWith('gdtpl:')) {
    return (db.prepare(
      `SELECT COUNT(*) AS n FROM gdtpl_levels WHERE list_slug = ? AND position BETWEEN ? AND ?`,
    ).get(source.slice('gdtpl:'.length), lo, hi) as { n: number }).n
  }
  return 0
}

/**
 * Link mirror rows back to the ALL list where the same level exists there, so
 * a list built from CCL still follows the ALL list's data for levels it shares
 * with it. Matched on gd_id, which is the only identifier both sides agree on.
 */
export function linkToAllLevels(db: DatabaseSync, rows: SourceRow[]): SourceRow[] {
  const ids = [...new Set(rows.map((r) => r.gd_id).filter((v): v is number => v != null))]
  if (!ids.length) return rows
  const ph = ids.map(() => '?').join(',')
  const found = db.prepare(
    `SELECT id, gd_id FROM levels WHERE gd_id IN (${ph})`,
  ).all(...ids) as { id: number; gd_id: number }[]
  const byGd = new Map(found.map((r) => [r.gd_id, r.id]))
  for (const r of rows) {
    if (r.level_id == null && r.gd_id != null) r.level_id = byGd.get(r.gd_id) ?? null
  }
  return rows
}

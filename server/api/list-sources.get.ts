import { getDb } from '~/server/db'
import { LIST_SOURCES, DATA_SOURCES } from '~/utils/list-source-catalog'
import { ALL_SHEET_URL } from '~/utils/sheet'

/**
 * Every list this site imports, with how much of it has landed.
 *
 * Built from the importer catalogue rather than from a hand-kept page, so
 * "Lists used" can never fall behind the importers again — adding one adds it
 * here. The counts are what makes the page worth reading: "CCL, 385 levels,
 * 84 of them also on the ALL" says something a link alone doesn't.
 */
type SourceInfo = {
  key: string
  label: string
  hint: string
  url: string | null
  /** Levels this source ranks that we have stored. */
  levels: number
  /** Of those, how many the ALL also carries. */
  shared: number | null
  /**
   * When this mirror was last refreshed.
   *
   * The page's most useful column and the one it was missing: a count says how
   * much of a list is here, and only a timestamp says whether it is *current*.
   * Null for sources with nothing stored yet, and for the ALL sheet itself,
   * whose freshness is the whole site's rather than one mirror's.
   */
  updated: string | null
}

export default defineEventHandler(() => {
  const db = getDb()
  const one = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...(params as any[])) as { n: number } | undefined)?.n ?? 0
  /** Newest `fetched_at` in a mirror table, or null when it holds nothing. */
  const lastFetch = (sql: string, ...params: unknown[]) => {
    try {
      return (db.prepare(sql).get(...(params as any[])) as { t: string | null } | undefined)?.t ?? null
    } catch {
      // A mirror that predates its own timestamp column shouldn't take the
      // page down; it simply has nothing to report.
      return null
    }
  }

  const out: SourceInfo[] = []

  for (const s of LIST_SOURCES) {
    if (s.key === 'all') {
      out.push({
        key: 'all',
        label: 'The ALL sheet',
        hint: 'The source of truth this whole site is built from',
        url: ALL_SHEET_URL,
        levels: one(`SELECT COUNT(*) AS n FROM levels`),
        shared: null,
        updated: null,
      })
      continue
    }

    let levels = 0
    let shared = 0
    let updated: string | null = null
    if (s.key === 'aredl') {
      levels = one(`SELECT COUNT(*) AS n FROM aredl_levels`)
        + one(`SELECT COUNT(*) AS n FROM levels WHERE aredl_position IS NOT NULL`)
      shared = one(`SELECT COUNT(*) AS n FROM levels WHERE aredl_position IS NOT NULL`)
      updated = lastFetch(`SELECT MAX(fetched_at) AS t FROM aredl_levels`)
    } else if (s.key === 'gdl') {
      levels = one(`SELECT COUNT(*) AS n FROM gdl_levels`)
      shared = one(`SELECT COUNT(*) AS n FROM levels WHERE gdl_position IS NOT NULL`)
      updated = lastFetch(`SELECT MAX(fetched_at) AS t FROM gdl_levels`)
    } else if (s.key === 'mscl') {
      levels = one(`SELECT COUNT(*) AS n FROM mscl_levels`)
      shared = one(
        `SELECT COUNT(*) AS n FROM mscl_levels m JOIN levels l ON l.gd_id = m.gd_id`,
      )
      updated = lastFetch(`SELECT MAX(fetched_at) AS t FROM mscl_levels`)
    } else if (s.key === 'acs') {
      levels = one(`SELECT COUNT(*) AS n FROM acs_levels`)
      shared = one(
        `SELECT COUNT(*) AS n FROM acs_levels p JOIN levels l ON l.gd_id = p.gd_id`,
      )
      updated = lastFetch(`SELECT MAX(fetched_at) AS t FROM acs_levels`)
    } else if (s.key.startsWith('gdtpl:')) {
      const slug = s.key.slice('gdtpl:'.length)
      levels = one(`SELECT COUNT(*) AS n FROM gdtpl_levels WHERE list_slug = ?`, slug)
      shared = one(
        `SELECT COUNT(*) AS n FROM gdtpl_levels g JOIN levels l ON l.gd_id = g.gd_id WHERE g.list_slug = ?`,
        slug,
      )
      updated = lastFetch(`SELECT MAX(fetched_at) AS t FROM gdtpl_levels WHERE list_slug = ?`, slug)
    }

    out.push({ key: s.key, label: s.label, hint: s.hint, url: s.url ?? null, levels, shared, updated })
  }

  for (const d of DATA_SOURCES) {
    const levels = d.key === 'pointercrate'
      ? one(`SELECT COUNT(*) AS n FROM levels WHERE pointercrate_position IS NOT NULL`)
      : 0
    out.push({
      key: d.key, label: d.label, hint: d.hint, url: d.url,
      levels,
      shared: d.key === 'pointercrate' ? levels : null,
      updated: d.key === 'pointercrate'
        ? lastFetch(`SELECT MAX(fetched_at) AS t FROM pointercrate_players`)
        : null,
    })
  }

  return { sources: out }
})

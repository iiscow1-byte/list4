import type { DatabaseSync } from 'node:sqlite'
import { GDTPL_LISTS } from '~/utils/list-source-catalog'

/**
 * Where else a level is ranked.
 *
 * The site mirrors a dozen lists, and until now a level's page only knew about
 * the four that have a dedicated column on `levels` — GDL, AREDL, Pointercrate
 * and the Challenge List. Everything imported through GDListTemplate (CCL, TSL,
 * EDI, …) lives in `gdtpl_levels` keyed by `gd_id`, so it was present in the
 * database and invisible on the page.
 *
 * The order below is the order the badges appear in, and it is deliberate:
 * GDL and AREDL first because those are the two lists a reader of the ALL is
 * most likely to be cross-referencing, then Pointercrate, then the challenge
 * lists. Only the first couple are shown as chips — see `BADGE_LIMIT`.
 */

export type OtherListEntry = {
  /** Stable key, matching `utils/list-source-catalog.ts` where there is one. */
  key: string
  /** Full name, for the "Rankings on other lists" panel. */
  list: string
  /** Short name, for the chip next to the level's title. */
  badge: string
  position: number
  /** The level's own page on that list, when the list has addressable levels. */
  url: string | null
  /**
   * The list's front page.
   *
   * Deep links into another site's level page are the ones that rot: AREDL
   * keys on a GD id the row may not carry, Pointercrate's path is a placement
   * that moves, and a GDListTemplate slug is only right until that list renames
   * the level. The panel links here instead — a homepage is the one address
   * about another list that stays true.
   */
  home: string | null
}

/** How many of these are worth putting next to the title. */
export const BADGE_LIMIT = 2

/**
 * GDListTemplate slugs read out of `gdtpl_levels`, in badge order.
 *
 * `cl` is absent on purpose: the Challenge List importer also writes
 * `levels.challenge_list_position`, and that column is the cleaned one — a
 * boot-time migration strips values the old name-based fallback guessed at. It
 * is read separately below so the level can't be counted twice.
 */
const GDTPL_BADGES: { slug: string; list: string; badge: string; home: string }[] =
  GDTPL_LISTS.map((l) => ({ slug: l.slug, list: l.label, badge: l.short, home: l.url }))

type LevelRow = {
  gd_id: number | null
  gdl_position: number | null
  aredl_position: number | null
  pointercrate_position: number | null
  challenge_list_position: number | null
  mscl_position: number | null
}

/**
 * Every list that ranks this level, best-known first.
 *
 * One query for the GDListTemplate lists rather than one per list; the rest are
 * columns already on the row the caller has.
 */
export function otherListsFor(db: DatabaseSync, level: LevelRow): OtherListEntry[] {
  const out: OtherListEntry[] = []

  if (level.gdl_position != null) {
    out.push({
      key: 'gdl',
      list: 'GDL',
      badge: 'GDL',
      position: level.gdl_position,
      url: 'https://demonlist.org',
      home: 'https://demonlist.org',
    })
  }
  if (level.aredl_position != null) {
    out.push({
      key: 'aredl',
      list: 'AREDL',
      badge: 'AREDL',
      position: level.aredl_position,
      url: level.gd_id ? `https://aredl.net/level/${level.gd_id}` : 'https://aredl.net',
      home: 'https://aredl.net',
    })
  }
  if (level.pointercrate_position != null) {
    out.push({
      key: 'pointercrate',
      list: 'Pointercrate',
      badge: 'PC',
      position: level.pointercrate_position,
      url: `https://pointercrate.com/demonlist/${level.pointercrate_position}/`,
      home: 'https://pointercrate.com/demonlist/',
    })
  }
  if (level.challenge_list_position != null) {
    out.push({
      key: 'gdtpl:cl',
      list: 'Challenge List',
      // "CH", not "CL": the two chips that most often sit side by side are this
      // one and CCL, and one character of difference between them is not enough
      // to read at a glance.
      badge: 'CH',
      position: level.challenge_list_position,
      url: `https://challengelist.gd/challenges/${level.challenge_list_position}/`,
      home: 'https://challengelist.gd',
    })
  }
  // The ACS is deliberately absent.
  //
  // `levels.acs_position` is still imported and still drives the challenge
  // queue, but this panel answers "where else is this level ranked", and the
  // ACS is not somewhere else — it is this project's own working sheet, the
  // place challenges are staged before they land here. Printing it beside GDL
  // and AREDL claimed a second, independent ranking agreed with us, when what
  // it actually showed was the ALL citing itself.
  if (level.mscl_position != null) {
    out.push({
      key: 'mscl',
      list: 'MSCL — Super Challenge List',
      badge: 'MSCL',
      position: level.mscl_position,
      url: 'https://mscl.dev',
      home: 'https://mscl.dev',
    })
  }

  if (level.gd_id != null) {
    const slugs = GDTPL_BADGES.map((g) => g.slug)
    const rows = db.prepare(
      `SELECT list_slug, position, level_slug FROM gdtpl_levels
        WHERE gd_id = ? AND list_slug IN (${slugs.map(() => '?').join(',')})`,
    ).all(level.gd_id, ...slugs) as { list_slug: string; position: number; level_slug: string }[]

    // Ordered by the table above rather than by whatever the query returned, so
    // "the first two badges" means the same thing on every level.
    const byslug = new Map(rows.map((r) => [r.list_slug, r]))
    for (const g of GDTPL_BADGES) {
      const hit = byslug.get(g.slug)
      if (!hit) continue
      out.push({
        key: `gdtpl:${g.slug}`,
        list: g.list,
        badge: g.badge,
        position: hit.position,
        // GDListTemplate sites route levels by their own slug.
        url: hit.level_slug ? `${g.home}/#/level/${encodeURIComponent(hit.level_slug)}` : g.home,
        home: g.home,
      })
    }
  }

  return out
}

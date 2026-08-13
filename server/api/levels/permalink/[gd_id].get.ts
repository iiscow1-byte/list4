import { getDb } from '~/server/db'

/**
 * Resolve a Geometry Dash level ID to everywhere it lives on this site.
 *
 * Powers `alllevelslist.com/<id>` — a link you can paste into a Discord message
 * without first opening the site to find out what placement the level is
 * currently at. Placements move; the GD ID never does, which is what makes it
 * the only durable thing to hang a permanent link on.
 *
 * ## Why this returns a list and not a level
 *
 * `levels.gd_id` is indexed but *not* unique, and deliberately so: the same GD
 * ID legitimately appears more than once on the list — a level re-uploaded
 * under the same ID, or two entries kept apart on purpose. The existing
 * `by-gd-id` lookup ends in `LIMIT 1`, which is fine for a search box that is
 * guessing at what you typed, and quite wrong for a permanent link, where
 * silently picking one of several and dropping the rest means the link takes
 * different people to different levels.
 *
 * So: every match, in list order, and the caller decides. One match redirects;
 * several ask.
 *
 * ## The other lists
 *
 * A level can be on the site without being on the main list — awaiting a
 * placement, awaiting a verification, or on the void list. A permalink that
 * 404s for a level the site is currently showing would be a link that breaks
 * for exactly the newest levels, which are the ones people are linking about.
 * Main-list hits come first because that is what an unqualified link means.
 */
export type PermalinkMatch = {
  kind: 'level' | 'awaiting' | 'open_verification' | 'void'
  /** Where to send the reader. */
  path: string
  name: string
  /** The number to show beside the name, when the list has one. */
  placement: number | null
}

export default defineEventHandler((event) => {
  const gdId = Number(getRouterParam(event, 'gd_id'))
  if (!Number.isInteger(gdId) || gdId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid level ID.' })
  }

  const db = getDb()
  const matches: PermalinkMatch[] = []

  for (const r of db.prepare(
    `SELECT position, sheet_placement, name FROM levels WHERE gd_id = ? ORDER BY position`,
  ).all(gdId) as { position: number; sheet_placement: number | null; name: string }[]) {
    matches.push({
      kind: 'level',
      path: `/levels/${r.position}`,
      name: r.name,
      placement: r.sheet_placement ?? r.position,
    })
  }

  for (const r of db.prepare(
    `SELECT id, name FROM awaiting_levels WHERE gd_id = ? ORDER BY id`,
  ).all(gdId) as { id: number; name: string }[]) {
    matches.push({ kind: 'awaiting', path: `/awaiting/${r.id}`, name: r.name, placement: null })
  }

  for (const r of db.prepare(
    `SELECT id, name FROM open_verifications WHERE gd_id = ? ORDER BY id`,
  ).all(gdId) as { id: number; name: string }[]) {
    matches.push({
      kind: 'open_verification',
      path: `/open-verifications/${r.id}`,
      name: r.name,
      placement: null,
    })
  }

  for (const r of db.prepare(
    `SELECT position, name FROM void_levels WHERE gd_id = ? ORDER BY position`,
  ).all(gdId) as { position: number; name: string }[]) {
    matches.push({ kind: 'void', path: `/void/${r.position}`, name: r.name, placement: r.position })
  }

  return { gd_id: gdId, matches }
})

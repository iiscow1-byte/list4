import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { afterListChange, removeLevel, tx } from '~/server/utils/list-ops'

/**
 * Take a level off the main list and put it back in Awaiting Placement, with
 * its details, so it can be placed again later.
 */
export default defineEventHandler((event) => {
  const account = requireAdmin(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad position.' })
  }

  const db = getDb()
  const lvl = db.prepare(`SELECT * FROM levels WHERE position = ?`).get(position) as any
  if (!lvl) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  const submitter = lvl.submitted_by
    ? (db.prepare(`SELECT username FROM accounts WHERE id = ?`).get(lvl.submitted_by) as { username: string } | undefined)?.username ?? null
    : null

  const awaitingId = tx(db, () => {
    const result = db.prepare(
      `INSERT INTO awaiting_levels
        (gd_id, name, verification, verification_url, verifier, verify_date,
         gddl_tier, difficulty, enjoyment, main_skillset, submitter, approved_by,
         placement_source, same_as_above, duplicate_of_id, is_alternate,
         alternate_of_id, placement_suggestion, rated, tentative_placement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      lvl.gd_id, lvl.name, lvl.verification, lvl.verification_url, lvl.verifier, lvl.verify_date,
      lvl.gddl_tier, lvl.difficulty, lvl.enjoyment, lvl.main_skillset, submitter, account.id,
      lvl.placement_source ?? 'All Levels List',
      lvl.same_as_above ? 1 : 0, lvl.duplicate_of_id ?? null, lvl.is_alternate ? 1 : 0, lvl.alternate_of_id ?? null,
      // Where it sat, as a starting point for placing it again.
      position,
      lvl.rated ?? null,
      lvl.tentative_placement ? 1 : 0,
    )
    removeLevel(db, lvl.id, account.id, { reason: 'Sent back to awaiting placement' })
    return Number(result.lastInsertRowid)
  })

  afterListChange(db)
  return { ok: true, awaitingId }
})

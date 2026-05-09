import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'

/**
 * Move a main-list level back to the Awaiting Placement list and remove it
 * from the main list (everything below shifts up by one). Inverse of the
 * awaiting "place" action. Carries the level's metadata into a fresh
 * awaiting_levels row so an admin can re-place it later.
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

  let awaitingId: number
  db.exec('BEGIN')
  try {
    const result = db.prepare(
      `INSERT INTO awaiting_levels
        (gd_id, name, verification, verification_url, verifier, verify_date,
         gddl_tier, difficulty, enjoyment, main_skillset, submitter, approved_by,
         placement_source, same_as_above, duplicate_of_id, is_alternate,
         alternate_of_id, placement_suggestion, rated, tentative_placement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      lvl.gd_id,
      lvl.name,
      lvl.verification,
      lvl.verification_url,
      lvl.verifier,
      lvl.verify_date,
      lvl.gddl_tier,
      lvl.difficulty,
      lvl.enjoyment,
      lvl.main_skillset,
      submitter,
      account.id,
      lvl.placement_source ?? 'All Levels List',
      lvl.same_as_above ? 1 : 0,
      lvl.duplicate_of_id ?? null,
      lvl.is_alternate ? 1 : 0,
      lvl.alternate_of_id ?? null,
      // Seed the placement suggestion from where it currently sits so an admin
      // re-placing it has a sensible starting point.
      position,
      lvl.rated ?? null,
      lvl.tentative_placement ? 1 : 0,
    )
    awaitingId = Number(result.lastInsertRowid)

    db.prepare(`DELETE FROM levels WHERE position = ?`).run(position)
    db.prepare(`UPDATE levels SET position = -(position - 1) WHERE position > ?`).run(position)
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  recomputePoints(db)

  return { ok: true, awaitingId }
})

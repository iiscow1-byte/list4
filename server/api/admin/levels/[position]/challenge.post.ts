import { getDb } from '~/server/db'
import { isAdminRole, isHelperRole, requireListStaff } from '~/server/utils/auth'
import { invalidateChallengeRanks } from '~/server/utils/challenge-rank'
import { invalidateChallengeLeaderboard } from '~/server/api/leaderboard/challenges.get'
import { fileHelperRequest } from '~/server/utils/helper-requests'
import { logActivity } from '~/server/utils/activity-log'

/**
 * Put a level on the challenge list, or take it off.
 *
 * Its own endpoint rather than a field on the metadata PATCH, because the two
 * have different rules. That PATCH refuses any level that isn't `permanent`,
 * and rightly so: everything it writes is sheet-owned and the next import would
 * overwrite it. These two columns are the opposite kind of value — a site-side
 * editorial decision no importer touches — and routing them through the same
 * door would have forced an admin to freeze a level against all future imports
 * just to correct which list it appears on.
 *
 * Marking deliberately does *not* go through `rated = 'Challenge'`, which looks
 * like the obvious way to do it. That column is imported from the sheet, and
 * `applyRatedFromSheet` clears any 'Challenge' the sheet doesn't also say — so
 * an admin's decision would have held until the next import and then quietly
 * undone itself.
 *
 * Both columns are written on every call, so the contradictory state where a
 * level is forced on and off at once is unreachable from here.
 *
 * ## Who may do it
 *
 * Whether a level is a challenge decides a whole public ranking, not one row's
 * metadata, so applying the change is admin-only.
 *
 * A **list helper** may ask for it. Their whole role is about what is on the
 * list, and "this is a challenge and it is filed as a level" is exactly the
 * kind of thing they are placed to notice — but the change moves the level
 * between two rankings and alters what it is worth on both, and it is only
 * reversible by somebody spotting it. So the same call from a helper files a
 * request instead of writing the columns, and answers `{ requested: true }`.
 * The client can then say "sent for review" rather than pretending it worked.
 */
export default defineEventHandler(async (event) => {
  const account = requireListStaff(event)
  if (!isAdminRole(account.role) && !isHelperRole(account.role)) {
    // Moderators are deliberately outside this one: they moderate people, and
    // the challenge list is a curation decision.
    throw createError({ statusCode: 403, statusMessage: 'Admins or list helpers only.' })
  }
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad position.' })
  }

  const body = await readBody<{ challenge?: unknown }>(event) ?? {}
  if (typeof body.challenge !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: '`challenge` must be true or false.' })
  }

  const db = getDb()
  const level = db.prepare(`SELECT id, name FROM levels WHERE position = ?`)
    .get(position) as { id: number; name: string } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  // A helper asks; an admin acts. See the note above.
  if (isHelperRole(account.role)) {
    const request = fileHelperRequest(db, {
      kind: body.challenge ? 'challenge' : 'unchallenge',
      level: { id: level.id, name: level.name, position },
      reason: typeof (body as { reason?: unknown }).reason === 'string'
        ? (body as { reason: string }).reason
        : null,
      by: account,
    })
    return { ok: true, requested: true, request_id: request.id, name: level.name, challenge: body.challenge }
  }

  db.prepare(`UPDATE levels SET force_challenge = ?, not_challenge = ? WHERE id = ?`)
    .run(body.challenge ? 1 : 0, body.challenge ? 0 : 1, level.id)

  logActivity({
    kind: body.challenge ? 'level.challenge.mark' : 'level.challenge.unmark',
    area: 'levels',
    severity: 'notable',
    actor: account,
    subject: { kind: 'level', id: level.id, label: level.name },
    summary: body.challenge
      ? `Marked ${level.name} as a challenge`
      : `Unmarked ${level.name} as a challenge`,
    detail: { position },
  }, db)

  // The challenge ranking just changed without the list changing shape, which
  // is the one thing the rank cache's stamp can't see.
  invalidateChallengeRanks()
  // And so did the challenge leaderboard: a level entering or leaving the
  // challenge list changes who is on that ranking and what they are worth.
  // Its own cache is time-based and would otherwise be up to 30 seconds behind
  // an admin who has just made the change and gone to look at the result.
  invalidateChallengeLeaderboard()

  return { ok: true, requested: false, name: level.name, challenge: body.challenge }
})

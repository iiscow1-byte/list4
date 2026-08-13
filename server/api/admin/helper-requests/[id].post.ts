import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { decideHelperRequest } from '~/server/utils/helper-requests'
import { moveLevel } from '~/server/utils/move-level'
import { invalidateChallengeRanks } from '~/server/utils/challenge-rank'
import { invalidateChallengeLeaderboard } from '~/server/api/leaderboard/challenges.get'
import { sendInboxMessage } from '~/server/utils/inbox'

/**
 * Apply or refuse one helper request.
 *
 * Admin-only, and that is the entire point of the queue existing: a helper can
 * ask for a move or a challenge change precisely because they cannot make one.
 *
 * ## Applying performs the real action
 *
 * A move goes through `moveLevel`, the same function the admin move tools use,
 * rather than writing `position` here. That function renumbers everything the
 * move displaces, writes the changelog and carries the tier across — a second
 * implementation would be a second set of rules for what a move means, and the
 * two drifting is how a list ends up disagreeing with itself.
 *
 * If the action fails the request is left `pending`. A request marked applied
 * whose change never happened is worse than one still waiting, because nobody
 * will look at it again.
 */
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request id.' })
  }

  const body = await readBody<{ action?: unknown; note?: unknown }>(event) ?? {}
  const action = body.action === 'apply' ? 'apply' : body.action === 'reject' ? 'reject' : null
  if (!action) throw createError({ statusCode: 400, statusMessage: '`action` must be apply or reject.' })
  const note = typeof body.note === 'string' ? body.note : null

  const db = getDb()
  const row = db.prepare(`SELECT * FROM helper_requests WHERE id = ?`).get(id) as {
    id: number
    kind: 'move' | 'challenge' | 'unchallenge' | 'remove'
    level_id: number | null
    level_name: string
    to_position: number | null
    status: string
    requested_by: number | null
  } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No such request.' })
  if (row.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'That request has already been decided.' })
  }

  if (action === 'apply') {
    if (row.level_id == null) {
      throw createError({ statusCode: 409, statusMessage: 'That level no longer exists.' })
    }
    const level = db.prepare(`SELECT id, position, name FROM levels WHERE id = ?`)
      .get(row.level_id) as { id: number; position: number; name: string } | undefined
    if (!level) throw createError({ statusCode: 409, statusMessage: 'That level no longer exists.' })

    if (row.kind === 'move') {
      if (!row.to_position) {
        throw createError({ statusCode: 400, statusMessage: 'That request has no target placement.' })
      }
      moveLevel(db, level.position, row.to_position, admin.id)
    } else if (row.kind === 'challenge' || row.kind === 'unchallenge') {
      const on = row.kind === 'challenge'
      db.prepare(`UPDATE levels SET force_challenge = ?, not_challenge = ? WHERE id = ?`)
        .run(on ? 1 : 0, on ? 0 : 1, level.id)
      // Both caches key on things that have not changed — the list's shape, and
      // the clock — so neither notices this on its own.
      invalidateChallengeRanks()
      invalidateChallengeLeaderboard()
    } else if (row.kind === 'remove') {
      // Deliberately not performed here. Removing a level cascades to its
      // records, its position history and its place in every custom list that
      // points at it, and the admin tools have a considered path for that.
      // Refusing to do it from a queue button is the right answer.
      throw createError({
        statusCode: 400,
        statusMessage: 'Removal requests are actioned from the level itself, not from here.',
      })
    }
  }

  const decided = decideHelperRequest(db, id, admin, action === 'apply' ? 'applied' : 'rejected', note)

  // Tell the helper what happened. A request whose outcome is only visible by
  // going and looking is a request most people will assume was ignored.
  if (row.requested_by) {
    sendInboxMessage(db, row.requested_by, {
      kind: 'staff',
      subject: action === 'apply'
        ? `Your ${row.kind} request for ${row.level_name} was applied`
        : `Your ${row.kind} request for ${row.level_name} was refused`,
      body: note,
      related_kind: 'helper_request',
      related_id: id,
      sent_by: admin.id,
    })
  }

  return { ok: true, request: decided }
})

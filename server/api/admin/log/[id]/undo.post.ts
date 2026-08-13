import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { undoActivity } from '~/server/utils/activity-undo'

/**
 * Reverse one logged action.
 *
 * Admin-only, and deliberately stricter than reading the log: undoing is
 * performing the action again in the opposite direction, so it needs the
 * authority to have performed it in the first place. The role handler checks
 * the assigner's own rank on top of that — see `activity-undo.ts` — because
 * otherwise the log would be a way around the ceiling on who may appoint whom.
 *
 * Every failure mode here is a conflict rather than a bug, and each says which
 * one it is: the kind has no inverse, somebody already undid it, or the world
 * has moved on and the change is no longer the most recent one.
 */
export default defineEventHandler((event) => {
  const me = requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad log entry id.' })
  }

  const result = undoActivity(getDb(), id, me)
  return { ok: true, summary: result.summary }
})

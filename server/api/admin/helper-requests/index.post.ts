import { getDb } from '~/server/db'
import { isHelperRole, requireListStaff } from '~/server/utils/auth'
import { fileHelperRequest, type HelperRequestKind } from '~/server/utils/helper-requests'

/**
 * A list helper asks for something they cannot do themselves.
 *
 * Helpers only. An admin reaching this would be filing a request for their own
 * queue, which is a longer way of doing the thing directly — and a moderator
 * has no business in the list's placements at all. Both are refused rather than
 * quietly allowed, so the queue stays what it says it is: the things a helper
 * has asked for.
 */
const KINDS = new Set<HelperRequestKind>(['move', 'challenge', 'unchallenge', 'remove'])

export default defineEventHandler(async (event) => {
  const account = requireListStaff(event)
  if (!isHelperRole(account.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This queue is for list helpers. You can make the change directly.',
    })
  }

  const body = await readBody<{
    kind?: unknown; position?: unknown; to_position?: unknown; reason?: unknown
  }>(event) ?? {}

  const kind = String(body.kind ?? '') as HelperRequestKind
  if (!KINDS.has(kind)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown request kind.' })
  }

  const position = Number(body.position)
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Which level?' })
  }

  const db = getDb()
  const level = db.prepare(`SELECT id, name, position FROM levels WHERE position = ?`)
    .get(position) as { id: number; name: string; position: number } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No level sits at that placement.' })

  let toPosition: number | null = null
  if (kind === 'move') {
    toPosition = Number(body.to_position)
    if (!Number.isInteger(toPosition) || toPosition <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'A move needs a target placement.' })
    }
    if (toPosition === level.position) {
      throw createError({ statusCode: 400, statusMessage: 'That is where it already is.' })
    }
  }

  // One open request per level per kind per helper. Asking twice does not make
  // the case stronger and it does make the queue unreadable.
  const existing = db.prepare(
    `SELECT id FROM helper_requests
      WHERE level_id = ? AND kind = ? AND requested_by = ? AND status = 'pending'`,
  ).get(level.id, kind, account.id)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'You already have that request open.' })
  }

  const request = fileHelperRequest(db, {
    kind,
    level,
    toPosition,
    reason: typeof body.reason === 'string' ? body.reason : null,
    by: account,
  })

  return { ok: true, request }
})

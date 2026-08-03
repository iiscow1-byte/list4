import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { unclaim, isClaimKind, CLAIM_KIND_LABELS } from '~/server/utils/unclaim'
import { invalidateLeaderboardCache } from '~/server/api/leaderboard.get'

/**
 * Give up a claim.
 *
 * With no `source`, this cancels an outstanding request — what the button next
 * to "waiting for review" has always done. With one, it releases a claim that
 * was already approved: the account stops being that player, the player becomes
 * claimable again, and the records the claim copied onto this profile go with
 * it. The source list keeps its own copy of those records; claiming again
 * brings the same set back.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const db = getDb()

  const q = getQuery(event)
  const source = q.source ?? (await readBody<{ source?: unknown }>(event).catch(() => null))?.source

  if (source == null || source === '') {
    const result = db.prepare(
      `DELETE FROM claim_requests WHERE account_id = ? AND status = 'pending'`,
    ).run(me.id)
    return { ok: true, cancelled: Number(result.changes) }
  }

  if (!isClaimKind(source)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown claim type.' })
  }

  const result = unclaim(db, me.id, source)
  if (!result.released) {
    throw createError({
      statusCode: 400,
      statusMessage: `You haven't claimed ${CLAIM_KIND_LABELS[source]}.`,
    })
  }
  invalidateLeaderboardCache()
  return { ok: true, ...result }
})

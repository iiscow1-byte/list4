import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { adoptClaimedRecords, claimKeysFor, type AdoptResult, type ClaimSource } from '~/server/utils/claim-records'
import { invalidateLeaderboardCache } from '~/server/api/leaderboard.get'

/**
 * Pull in the records behind every account you've claimed.
 *
 * Approving a claim already does this once. This is the same operation on
 * demand, which covers the two cases the one-shot doesn't: claims approved
 * before the site did this at all, and records the mirror has picked up since —
 * beating a new demon on AREDL should show here without re-claiming anything.
 *
 * Idempotent by construction: a level that already carries a record under this
 * name is counted, not written again.
 */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const db = getDb()

  const keys = claimKeysFor(db, me.id)
  const sources = Object.keys(keys) as ClaimSource[]
  if (!sources.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'You haven\'t claimed an AREDL, GDL or Pointercrate player yet.',
    })
  }

  const results: AdoptResult[] = []
  for (const source of sources) {
    results.push(adoptClaimedRecords(db, me.id, source, keys[source]!))
  }

  const added = results.reduce((n, r) => n + r.added, 0)
  if (added) invalidateLeaderboardCache()

  return { ok: true, added, results }
})

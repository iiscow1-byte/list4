import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

/**
 * Returns the median position of all existing main-list levels in a given
 * tier (e.g. "Tier 5", "Subtier 2"). Used by the pending-review UI to
 * autofill a sensible default placement when a submission only specifies
 * a tier and the submitter didn't provide a position estimate.
 */
export default defineEventHandler((event) => {
  requireMod(event)
  const q = getQuery(event)
  const tier = typeof q.tier === 'string' ? q.tier.trim() : ''
  if (!tier) {
    throw createError({ statusCode: 400, statusMessage: 'Missing tier' })
  }

  const db = getDb()
  const rows = db
    .prepare(`SELECT position FROM levels WHERE gddl_tier = ? ORDER BY position ASC`)
    .all(tier) as { position: number }[]
  if (rows.length === 0) return { tier, count: 0, midpoint: null }

  const mid = rows[Math.floor(rows.length / 2)]!.position
  return { tier, count: rows.length, midpoint: mid }
})

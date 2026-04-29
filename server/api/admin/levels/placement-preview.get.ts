import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

/**
 * Preview helper for the level-placement UI: given a candidate `position`,
 * returns the 3 levels that would land above and the 3 below it, plus the
 * nearest Featured-rated level above and the nearest Featured below.
 */
export default defineEventHandler((event) => {
  requireMod(event)
  const q = getQuery(event)
  const placement = Number(q.position)
  if (!Number.isInteger(placement) || placement <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const db = getDb()

  const above = db
    .prepare(
      `SELECT position, name, rated, gddl_tier, difficulty
       FROM levels WHERE position < ?
       ORDER BY position DESC LIMIT 3`,
    )
    .all(placement) as any[]

  const below = db
    .prepare(
      `SELECT position, name, rated, gddl_tier, difficulty
       FROM levels WHERE position >= ?
       ORDER BY position ASC LIMIT 3`,
    )
    .all(placement) as any[]

  const featuredAbove = db
    .prepare(
      `SELECT position, name, rated, gddl_tier, difficulty
       FROM levels WHERE position < ? AND rated = 'Featured'
       ORDER BY position DESC LIMIT 1`,
    )
    .get(placement) as any | undefined

  const featuredBelow = db
    .prepare(
      `SELECT position, name, rated, gddl_tier, difficulty
       FROM levels WHERE position >= ? AND rated = 'Featured'
       ORDER BY position ASC LIMIT 1`,
    )
    .get(placement) as any | undefined

  return {
    placement,
    above: above.reverse(),  // sort ascending so the UI reads top-to-bottom
    below,
    featuredAbove: featuredAbove ?? null,
    featuredBelow: featuredBelow ?? null,
  }
})

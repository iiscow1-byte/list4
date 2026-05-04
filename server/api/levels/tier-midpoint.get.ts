import { getDb } from '~/server/db'

/** Returns the median list position for all levels in a given tier. Public endpoint. */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const tier = typeof q.tier === 'string' ? q.tier.trim() : ''
  if (!tier) throw createError({ statusCode: 400, statusMessage: 'Missing tier' })

  const db = getDb()
  const rows = db
    .prepare(`SELECT position FROM levels WHERE gddl_tier = ? ORDER BY position ASC`)
    .all(tier) as { position: number }[]
  if (rows.length === 0) return { tier, count: 0, midpoint: null }

  const mid = rows[Math.floor(rows.length / 2)]!.position
  return { tier, count: rows.length, midpoint: mid }
})

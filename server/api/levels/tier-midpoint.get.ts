import { getDb } from '~/server/db'

/** Returns the list position at `frac` (0–1) through all levels in a given tier.
 *  frac defaults to 0.5 (midpoint). Public endpoint. */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const tier = typeof q.tier === 'string' ? q.tier.trim() : ''
  const frac = typeof q.frac === 'string' ? Math.max(0, Math.min(1, Number(q.frac))) : 0.5
  if (!tier) throw createError({ statusCode: 400, statusMessage: 'Missing tier' })

  const db = getDb()
  const rows = db
    .prepare(`SELECT position FROM levels WHERE gddl_tier = ? ORDER BY position ASC`)
    .all(tier) as { position: number }[]
  if (rows.length === 0) return { tier, count: 0, midpoint: null }

  const idx = Math.min(rows.length - 1, Math.floor(frac * rows.length))
  return { tier, count: rows.length, midpoint: rows[idx]!.position }
})

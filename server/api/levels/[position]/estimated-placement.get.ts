import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const db = getDb()

  // Find the nearest ALL-list levels above and below this position that have
  // AREDL rankings — these bracket where this level would likely appear on AREDL.
  const above = db.prepare(
    `SELECT position, name, aredl_position
       FROM levels
      WHERE aredl_position IS NOT NULL AND position < ?
      ORDER BY position DESC LIMIT 1`,
  ).get(position) as { position: number; name: string; aredl_position: number } | undefined

  const below = db.prepare(
    `SELECT position, name, aredl_position
       FROM levels
      WHERE aredl_position IS NOT NULL AND position > ?
      ORDER BY position ASC LIMIT 1`,
  ).get(position) as { position: number; name: string; aredl_position: number } | undefined

  // Estimate AREDL position by linear interpolation between the two bracket levels.
  let estimated_aredl: number | null = null
  if (above && below) {
    const span = below.position - above.position
    const frac = (position - above.position) / span
    estimated_aredl = Math.round(above.aredl_position + frac * (below.aredl_position - above.aredl_position))
  } else if (above) {
    estimated_aredl = above.aredl_position + 1
  } else if (below) {
    estimated_aredl = Math.max(1, below.aredl_position - 1)
  }

  return {
    estimated_aredl,
    bracket: {
      above: above ? { position: above.position, name: above.name, aredl_position: above.aredl_position } : null,
      below: below ? { position: below.position, name: below.name, aredl_position: below.aredl_position } : null,
    },
  }
})

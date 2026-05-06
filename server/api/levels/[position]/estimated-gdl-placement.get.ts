import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const db = getDb()

  const above = db.prepare(
    `SELECT position, name, gdl_position
       FROM levels
      WHERE gdl_position IS NOT NULL AND position < ?
      ORDER BY position DESC LIMIT 1`,
  ).get(position) as { position: number; name: string; gdl_position: number } | undefined

  const below = db.prepare(
    `SELECT position, name, gdl_position
       FROM levels
      WHERE gdl_position IS NOT NULL AND position > ?
      ORDER BY position ASC LIMIT 1`,
  ).get(position) as { position: number; name: string; gdl_position: number } | undefined

  let estimated_gdl: number | null = null
  if (above && below) {
    const span = below.position - above.position
    const frac = (position - above.position) / span
    estimated_gdl = Math.round(above.gdl_position + frac * (below.gdl_position - above.gdl_position))
  } else if (above) {
    estimated_gdl = above.gdl_position + 1
  } else if (below) {
    estimated_gdl = Math.max(1, below.gdl_position - 1)
  }

  return {
    estimated_gdl,
    bracket: {
      above: above ? { position: above.position, name: above.name, gdl_position: above.gdl_position } : null,
      below: below ? { position: below.position, name: below.name, gdl_position: below.gdl_position } : null,
    },
  }
})

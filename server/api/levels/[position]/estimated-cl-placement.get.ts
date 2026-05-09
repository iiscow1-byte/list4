import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const db = getDb()

  const above = db.prepare(
    `SELECT position, name, challenge_list_position
       FROM levels
      WHERE challenge_list_position IS NOT NULL AND position < ?
      ORDER BY position DESC LIMIT 1`,
  ).get(position) as { position: number; name: string; challenge_list_position: number } | undefined

  const below = db.prepare(
    `SELECT position, name, challenge_list_position
       FROM levels
      WHERE challenge_list_position IS NOT NULL AND position > ?
      ORDER BY position ASC LIMIT 1`,
  ).get(position) as { position: number; name: string; challenge_list_position: number } | undefined

  let estimated_cl: number | null = null
  if (above && below) {
    const span = below.position - above.position
    const frac = (position - above.position) / span
    estimated_cl = Math.round(above.challenge_list_position + frac * (below.challenge_list_position - above.challenge_list_position))
  } else if (above) {
    estimated_cl = above.challenge_list_position + 1
  } else if (below) {
    estimated_cl = Math.max(1, below.challenge_list_position - 1)
  }

  return {
    estimated_cl,
    bracket: {
      above: above ? { position: above.position, name: above.name, challenge_list_position: above.challenge_list_position } : null,
      below: below ? { position: below.position, name: below.name, challenge_list_position: below.challenge_list_position } : null,
    },
  }
})

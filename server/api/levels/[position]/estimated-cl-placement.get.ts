import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const db = getDb()

  // Anchor levels: ALL-list levels matched to the CL by gd_id.
  // For "above" (harder than target in ALL): take the one with the highest CL position
  // (easiest among the harder group) — this is the tightest CL upper bound.
  // For "below" (easier than target in ALL): take the one with the lowest CL position
  // (hardest among the easier group) — this is the tightest CL lower bound.
  const above = db.prepare(`
    SELECT l.position, l.name, g.position AS challenge_list_position
      FROM gdtpl_levels g
      JOIN levels l ON l.gd_id = g.gd_id
     WHERE g.list_slug = 'cl' AND l.gd_id IS NOT NULL AND l.position < ?
     ORDER BY g.position DESC LIMIT 1
  `).get(position) as { position: number; name: string; challenge_list_position: number } | undefined

  const below = db.prepare(`
    SELECT l.position, l.name, g.position AS challenge_list_position
      FROM gdtpl_levels g
      JOIN levels l ON l.gd_id = g.gd_id
     WHERE g.list_slug = 'cl' AND l.gd_id IS NOT NULL AND l.position > ?
     ORDER BY g.position ASC LIMIT 1
  `).get(position) as { position: number; name: string; challenge_list_position: number } | undefined

  let estimated_cl: number | null = null
  if (above && below) {
    const a = above.challenge_list_position
    const b = below.challenge_list_position
    if (a === b) {
      estimated_cl = a
    } else {
      const span = below.position - above.position
      const frac = span > 0 ? (position - above.position) / span : 0.5
      const raw = a + frac * (b - a)
      // Clamp to the bracket range regardless of ordering direction
      estimated_cl = Math.round(Math.min(Math.max(raw, Math.min(a, b)), Math.max(a, b)))
    }
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

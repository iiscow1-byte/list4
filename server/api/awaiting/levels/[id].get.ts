import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const db = getDb()
  const level = db
    .prepare(
      `SELECT id, gd_id, name, fps, game_version, verification, verification_url, verifier,
              verify_date, gddl_tier, difficulty, enjoyment, main_skillset, tags, notes,
              submitter, approved_at
       FROM awaiting_levels WHERE id = ?`,
    )
    .get(id) as any
  if (!level) throw createError({ statusCode: 404, statusMessage: 'Awaiting level not found' })
  return level
})

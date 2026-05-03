import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const db = getDb()
  const level = db
    .prepare(
      `SELECT o.id, o.gd_id, o.name, o.fps, o.game_version, o.showcase_url, o.verifier,
              o.gddl_tier, o.difficulty, o.enjoyment, o.main_skillset, o.tags, o.notes,
              o.placement_source, o.submitted_at, o.status,
              a.username AS submitter
         FROM open_verifications o
         LEFT JOIN accounts a ON a.id = o.submitted_by
        WHERE o.id = ? AND o.status = 'approved'`,
    )
    .get(id) as any
  if (!level) throw createError({ statusCode: 404, statusMessage: 'Open verification not found' })
  return level
})

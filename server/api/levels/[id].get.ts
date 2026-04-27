import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid id' })

  const db = getDb()
  const level = db.prepare(`SELECT * FROM levels WHERE id = ?`).get(id) as any
  if (!level) throw createError({ statusCode: 404, statusMessage: 'Level not found' })

  const records = db
    .prepare(
      `SELECT r.percent, r.hz, r.video, p.name AS player, p.country
       FROM records r JOIN players p ON p.id = r.player_id
       WHERE r.level_id = ? AND r.verified = 1
       ORDER BY r.percent DESC, p.name COLLATE NOCASE ASC`,
    )
    .all(id)

  return {
    ...level,
    tags: JSON.parse(level.tags || '[]'),
    records,
  }
})

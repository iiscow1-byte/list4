import { getDb } from '~/server/db'
import { communityStats } from '~/server/utils/opinions'

export default defineEventHandler((event) => {
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const db = getDb()
  const level = db.prepare(`SELECT * FROM levels WHERE position = ?`).get(position) as any
  if (!level) throw createError({ statusCode: 404, statusMessage: 'Level not found' })

  const records = db
    .prepare(
      `SELECT r.percent, r.hz, r.video, r.player_name AS player, p.country
       FROM records r
       LEFT JOIN players p ON p.id = r.player_id
       WHERE r.level_id = ? AND r.permanent = 1
       ORDER BY r.percent DESC, r.player_name COLLATE NOCASE ASC`,
    )
    .all(level.id)

  const community = communityStats(db, 'main', level.id)
  // If the community has settled on an enjoyment, prefer it over the imported
  // sheet value for display purposes.
  const enjoyment = community.community_enjoyment ?? level.enjoyment

  return { ...level, enjoyment, records, community }
})

import { getDb } from '~/server/db'
import { communityStats } from '~/server/utils/opinions'

export default defineEventHandler((event) => {
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }
  const db = getDb()
  const level = db.prepare(`SELECT * FROM void_levels WHERE position = ?`).get(position) as any
  if (!level) throw createError({ statusCode: 404, statusMessage: 'Void level not found' })
  const community = communityStats(db, 'void', level.id)
  return { ...level, community }
})

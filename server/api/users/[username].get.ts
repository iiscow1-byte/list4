import { getDb } from '~/server/db'
import { getPlayerStats, getCompletedLevels, getCreatedLevels } from '~/server/utils/profile'

export default defineEventHandler((event) => {
  const username = getRouterParam(event, 'username')
  if (!username) throw createError({ statusCode: 400, statusMessage: 'username required' })

  const db = getDb()
  const acc = db.prepare(
    `SELECT id, username, role, bio, country, subdivision, claimed_player,
            (avatar_blob IS NOT NULL) AS has_avatar, created_at
       FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as any
  if (!acc) throw createError({ statusCode: 404, statusMessage: 'No such user.' })
  acc.has_avatar = !!acc.has_avatar

  const player = acc.claimed_player ? getPlayerStats(db, acc.claimed_player) : null
  const completedLevels = acc.claimed_player ? getCompletedLevels(db, acc.claimed_player) : []
  const createdLevels = acc.claimed_player ? getCreatedLevels(db, acc.claimed_player) : []

  return { account: acc, player, completedLevels, createdLevels }
})

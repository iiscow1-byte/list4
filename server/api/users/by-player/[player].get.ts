import { getDb } from '~/server/db'
import { getPlayerStats, getCompletedLevels, getCreatedLevels } from '~/server/utils/profile'

export default defineEventHandler((event) => {
  const playerName = getRouterParam(event, 'player')
  if (!playerName) throw createError({ statusCode: 400, statusMessage: 'player required' })

  const db = getDb()
  const player = getPlayerStats(db, playerName)
  if (!player) throw createError({ statusCode: 404, statusMessage: 'Player not found on the leaderboard.' })

  const acc = db.prepare(
    `SELECT username FROM accounts WHERE claimed_player = ? COLLATE NOCASE`,
  ).get(player.name) as { username: string } | undefined

  const completedLevels = getCompletedLevels(db, player.name)
  const createdLevels = getCreatedLevels(db, player.name)

  return {
    player,
    claimedBy: acc?.username ?? null,
    completedLevels,
    createdLevels,
  }
})

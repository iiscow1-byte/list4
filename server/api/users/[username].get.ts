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

  // Player stats and creator credits only make sense for a claimed leaderboard
  // player. Records, however, can be submitted before a claim is approved, so we
  // also resolve completed-levels by the username when there's no claim yet.
  const effectiveName = acc.claimed_player ?? acc.username
  const player = acc.claimed_player ? getPlayerStats(db, acc.claimed_player) : null
  const completedLevels = getCompletedLevels(db, effectiveName)
  const createdLevels = acc.claimed_player ? getCreatedLevels(db, acc.claimed_player) : []

  return { account: acc, player, completedLevels, createdLevels }
})

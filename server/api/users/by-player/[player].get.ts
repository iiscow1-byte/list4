import { getDb } from '~/server/db'
import { getPlayerStats, getCompletedLevels, getCreatedLevels } from '~/server/utils/profile'
import { computeDerivedStats } from '~/server/utils/leaderboard'
import { getCurrentAccount } from '~/server/utils/auth'
import { isFollowing } from '~/server/utils/follows'

function followInfo(db: ReturnType<typeof getDb>, event: any, target: string) {
  const me = getCurrentAccount(event)
  const myCanonical = me ? (me.claimed_player ?? me.username) : null
  const isSelf = !!myCanonical && myCanonical.toLowerCase() === target.toLowerCase()
  const followed = me && !isSelf ? isFollowing(db, me.id, target) : false
  const followerCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM follows WHERE target_name = ? COLLATE NOCASE`,
  ).get(target) as { n: number }).n
  return { target, followed, followerCount, isSelf, canFollow: !!me && !isSelf }
}

export default defineEventHandler((event) => {
  const playerName = getRouterParam(event, 'player')
  if (!playerName) throw createError({ statusCode: 400, statusMessage: 'player required' })

  const db = getDb()
  const sheetPlayer = getPlayerStats(db, playerName)

  if (sheetPlayer) {
    const acc = db.prepare(
      `SELECT username FROM accounts WHERE claimed_player = ? COLLATE NOCASE`,
    ).get(sheetPlayer.name) as { username: string } | undefined

    return {
      player: sheetPlayer,
      claimedBy: acc?.username ?? null,
      derived: false,
      completedLevels: getCompletedLevels(db, sheetPlayer.name),
      createdLevels: getCreatedLevels(db, sheetPlayer.name),
      follow: followInfo(db, event, sheetPlayer.name),
    }
  }

  // Not on the leaderboard — try to derive stats from accepted records.
  const stats = computeDerivedStats(db, playerName)
  if (!stats) {
    throw createError({ statusCode: 404, statusMessage: 'Player not found.' })
  }

  // If a registered username matches this name, surface it as `claimedBy` so
  // the client redirects to that account's profile (claim_player can never
  // equal a non-leaderboard name, so this is the only association possible).
  const acc = db.prepare(
    `SELECT username FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(stats.name) as { username: string } | undefined

  return {
    player: { ...stats, country: null },
    claimedBy: acc?.username ?? null,
    derived: true,
    completedLevels: getCompletedLevels(db, stats.name),
    createdLevels: getCreatedLevels(db, stats.name),
    follow: followInfo(db, event, stats.name),
  }
})

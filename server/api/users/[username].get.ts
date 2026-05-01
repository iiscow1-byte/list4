import { getDb } from '~/server/db'
import { getPlayerStats, getCompletedLevels, getCreatedLevels, getVerifiedLevels } from '~/server/utils/profile'
import { computeDerivedStats } from '~/server/utils/leaderboard'

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

  // Use the claimed leaderboard name when available, else the username — for
  // both records lookup and derived stats.
  const effectiveName = acc.claimed_player ?? acc.username

  // Sheet stats win when bound to a leaderboard player; otherwise fall back to
  // stats derived from accepted records under the effective name. Modern
  // accounts (no leaderboard claim) get the same stats box as legacy unclaimed
  // profiles, just computed instead of pulled from the sheet.
  let player: { name: string; country: string | null; total_points: number; skill_points: number; hardest: string | null; tier: string | null } | null = null
  if (acc.claimed_player) {
    player = getPlayerStats(db, acc.claimed_player)
  }
  if (!player) {
    const derived = computeDerivedStats(db, effectiveName)
    if (derived) player = { ...derived, country: null }
  }

  const completedLevels = getCompletedLevels(db, effectiveName)
  const createdLevels = getCreatedLevels(db, effectiveName)
  const verifiedLevels = getVerifiedLevels(db, effectiveName)

  return { account: acc, player, completedLevels, createdLevels, verifiedLevels }
})

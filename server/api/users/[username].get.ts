import { getDb } from '~/server/db'
import { getPlayerStats, getCompletedLevels, getCreatedLevels, getVerifiedLevels, getProgressPosts } from '~/server/utils/profile'
import { computeDerivedStats } from '~/server/utils/leaderboard'
import { getCurrentAccount } from '~/server/utils/auth'
import { isFollowing } from '~/server/utils/follows'

export default defineEventHandler((event) => {
  const username = getRouterParam(event, 'username')
  if (!username) throw createError({ statusCode: 400, statusMessage: 'username required' })

  const db = getDb()
  const acc = db.prepare(
    `SELECT id, username, role, bio, country, subdivision, claimed_player,
            (avatar_blob IS NOT NULL) AS has_avatar, created_at,
            pronouns, discord_handle, youtube_url,
            favorite_level_id, favorite_level_note
       FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as any
  if (!acc) throw createError({ statusCode: 404, statusMessage: 'No such user.' })
  acc.has_avatar = !!acc.has_avatar

  const favorite_level = acc.favorite_level_id
    ? (db.prepare(`SELECT id, position, name, gddl_tier FROM levels WHERE id = ?`).get(acc.favorite_level_id) as { id: number; position: number; name: string; gddl_tier: string | null } | null)
    : null

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
  const progressPosts = getProgressPosts(db, acc.id)

  // Follow status: canonical name is the follow key; the viewer can only
  // follow if they're signed in and not viewing their own profile.
  const me = getCurrentAccount(event)
  const myCanonical = me ? (me.claimed_player ?? me.username) : null
  const followTarget = effectiveName
  const isSelf = !!myCanonical && myCanonical.toLowerCase() === followTarget.toLowerCase()
  const followed = me && !isSelf ? isFollowing(db, me.id, followTarget) : false
  const followerCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM follows WHERE target_name = ? COLLATE NOCASE`,
  ).get(followTarget) as { n: number }).n

  return {
    account: acc,
    player,
    completedLevels,
    createdLevels,
    verifiedLevels,
    progressPosts,
    follow: { target: followTarget, followed, followerCount, isSelf, canFollow: !!me && !isSelf },
    favorite_level,
    favorite_level_note: acc.favorite_level_note ?? null,
  }
})

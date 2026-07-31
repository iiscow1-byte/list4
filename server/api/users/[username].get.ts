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

  // Who follows this profile, and who it follows back. Follows are keyed on a
  // canonical name rather than an account id (so you can follow a leaderboard
  // player who hasn't signed up), which is why the "following" side joins back
  // through the account's own canonical name.
  const followers = db.prepare(
    `SELECT a.username, (a.avatar_blob IS NOT NULL) AS has_avatar
       FROM follows f
       JOIN accounts a ON a.id = f.follower_account_id
      WHERE f.target_name = ? COLLATE NOCASE AND a.banned_at IS NULL
      ORDER BY f.created_at DESC
      LIMIT 24`,
  ).all(followTarget) as { username: string; has_avatar: number }[]

  const following = db.prepare(
    `SELECT f.target_name AS name,
            (SELECT username FROM accounts a
              WHERE (a.claimed_player = f.target_name COLLATE NOCASE
                     OR a.username = f.target_name COLLATE NOCASE)
                AND a.banned_at IS NULL
              LIMIT 1) AS username
       FROM follows f
      WHERE f.follower_account_id = ?
      ORDER BY f.created_at DESC
      LIMIT 24`,
  ).all(acc.id) as { name: string; username: string | null }[]

  const followingCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM follows WHERE follower_account_id = ?`,
  ).get(acc.id) as { n: number }).n

  // The profile owner's published lists. Private drafts stay hidden unless
  // the viewer is the owner.
  const publicLists = db.prepare(
    `SELECT cl.public_id, cl.title, cl.likes, cl.is_public, cl.updated_at,
            (SELECT COUNT(*) FROM custom_list_items i WHERE i.list_id = cl.id) AS item_count
       FROM custom_lists cl
      WHERE cl.owner_account_id = ?
        AND (cl.is_public = 1 OR ? = 1)
      ORDER BY cl.is_public DESC, cl.likes DESC, cl.updated_at DESC
      LIMIT 12`,
  ).all(acc.id, me && me.id === acc.id ? 1 : 0)

  return {
    account: acc,
    player,
    completedLevels,
    createdLevels,
    verifiedLevels,
    progressPosts,
    follow: {
      target: followTarget, followed, followerCount, followingCount,
      isSelf, canFollow: !!me && !isSelf,
      followers, following,
    },
    publicLists,
    favorite_level,
    favorite_level_note: acc.favorite_level_note ?? null,
  }
})

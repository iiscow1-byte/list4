import { getDb } from '~/server/db'
import { getPlayerStats, getCompletedLevels, getCreatedLevels, getVerifiedLevels, getProgressPosts } from '~/server/utils/profile'
import { computeDerivedStats } from '~/server/utils/leaderboard'
import { getCurrentAccount } from '~/server/utils/auth'
import { isFollowing } from '~/server/utils/follows'
import { looksAutomated, recordProfileView } from '~/server/utils/analytics'
import { clanForAccount } from '~/server/utils/clans'

export default defineEventHandler((event) => {
  const username = getRouterParam(event, 'username')
  if (!username) throw createError({ statusCode: 400, statusMessage: 'username required' })

  const db = getDb()
  const acc = db.prepare(
    `SELECT id, username, role, bio, country, subdivision, claimed_player,
            (avatar_blob IS NOT NULL) AS has_avatar, created_at,
            pronouns, discord_handle, youtube_url, gd_username,
            twitch_url, twitter_url, bluesky_url,
            favorite_level_id, favorite_level_note,
            hardest_record_id, banner_choice, banner_level_id,
            banner_image_url, name_emoji, name_badge, name_badge_color
       FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as any
  if (!acc) throw createError({ statusCode: 404, statusMessage: 'No such user.' })
  acc.has_avatar = !!acc.has_avatar

  const levelCard = db.prepare(
    `SELECT id, position, sheet_placement, name, gddl_tier, gd_id, creator, verification_url
       FROM levels WHERE id = ?`,
  )

  const favorite_level = acc.favorite_level_id
    ? (levelCard.get(acc.favorite_level_id) as any | null)
    : null

  // A free-choice header level, unrelated to either showcase pick.
  const banner_level = acc.banner_level_id
    ? (levelCard.get(acc.banner_level_id) as any | null)
    : null

  // The pinned completion. Joined through `records` so the percent and the
  // proof link travel with it, and re-checked against the profile's own name
  // so a since-renamed claim can't leave someone else's record pinned here.
  const hardest_completion = acc.hardest_record_id
    ? (db.prepare(
        `SELECT r.id AS record_id, r.percent, r.video, r.hz, r.player_name,
                l.id AS level_id, l.position, l.sheet_placement, l.name, l.gd_id,
                l.gddl_tier, l.creator, l.points, l.verification_url
           FROM records r
           JOIN levels l ON l.id = r.level_id
          WHERE r.id = ? AND r.permanent = 1`,
      ).get(acc.hardest_record_id) as any | null)
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

  /**
   * How much of the list this is.
   *
   * A completion count says how much somebody has done; it takes the size of
   * the list to say how far through it they are. Sent as the denominator
   * rather than a percentage so the page can round it once, in the place that
   * decides how many digits are worth showing.
   */
  const totalLevels = (db.prepare(`SELECT COUNT(*) AS n FROM levels`).get() as { n: number }).n
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

  /**
   * The two things a follow list can say that a count can't.
   *
   * `followsYou` is whether this profile follows *the viewer* back, and
   * `mutuals` is how many people you both follow. Both are one query against a
   * table the page already reads, and both are the difference between a number
   * and a relationship — which is the whole point of a follow.
   *
   * Only computed for a signed-in viewer looking at somebody else: neither
   * means anything otherwise, and asking the database is a waste of a query.
   */
  let followsYou = false
  let mutuals = 0
  if (me && !isSelf && myCanonical) {
    followsYou = !!db.prepare(
      `SELECT 1 FROM follows WHERE follower_account_id = ? AND target_name = ? COLLATE NOCASE`,
    ).get(acc.id, myCanonical)
    mutuals = (db.prepare(
      `SELECT COUNT(*) AS n FROM follows mine
         JOIN follows theirs ON theirs.target_name = mine.target_name COLLATE NOCASE
        WHERE mine.follower_account_id = ? AND theirs.follower_account_id = ?`,
    ).get(me.id, acc.id) as { n: number }).n
  }

  /**
   * How many people have opened this profile.
   *
   * Read before the increment and not counted for the owner: a number that
   * goes up every time you look at your own page is a count of you checking
   * it. Recorded here rather than in the analytics middleware for the same
   * reason level views are — the middleware sees `/users/:username`, and this
   * handler knows which account that is.
   */
  const profileViews = (db.prepare(
    `SELECT COALESCE(views, 0) AS n FROM profile_views WHERE account_id = ?`,
  ).get(acc.id) as { n: number } | undefined)?.n ?? 0
  if (!me || me.id !== acc.id) {
    if (!looksAutomated(getHeader(event, 'user-agent') ?? '')) recordProfileView(acc.id)
  }

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

  // The clan rides on the account rather than beside it, because the header
  // draws it as part of the name and takes the whole account as one prop.
  const clan = clanForAccount(db, acc.id)
  acc.clan = clan ? { tag: clan.tag, name: clan.name, color: clan.color } : null
  acc.clan_role = clan?.role ?? null

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
      followers, following, followsYou, mutuals,
    },
    profileViews,
    totalLevels,
    publicLists,
    favorite_level,
    favorite_level_note: acc.favorite_level_note ?? null,
    // Drop the pin if the profile's canonical name has moved on since it was
    // set — the record is someone else's now, and showing it would be a lie.
    hardest_completion:
      hardest_completion &&
      hardest_completion.player_name?.toLowerCase() === effectiveName.toLowerCase()
        ? hardest_completion
        : null,
    banner_choice: acc.banner_choice ?? 'hardest',
    banner_level,
  }
})

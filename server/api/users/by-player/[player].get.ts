import { getDb } from '~/server/db'
import { getPlayerStats, getCompletedLevels, getCreatedLevels } from '~/server/utils/profile'
import { computeDerivedStats } from '~/server/utils/leaderboard'
import { getCurrentAccount } from '~/server/utils/auth'
import { isFollowing } from '~/server/utils/follows'

export type ExternalProfile = {
  source: 'aredl' | 'pointercrate' | 'gdl'
  label: string
  /** Route on this site for that list's own player page. */
  to: string
  name: string
  country: string | null
  rank: number | null
  points: number | null
}

/**
 * The other lists that know this player, matched by name.
 *
 * Name is the only identifier the four lists share, which is why this is a
 * lookup rather than a join: there is no cross-list id to key on. Matching is
 * case-insensitive because the lists disagree about capitalisation constantly.
 */
function externalProfiles(db: ReturnType<typeof getDb>, name: string): ExternalProfile[] {
  const out: ExternalProfile[] = []

  const aredl = db.prepare(
    `SELECT uuid, global_name, country, rank, total_points FROM aredl_players
      WHERE global_name = ? COLLATE NOCASE OR username = ? COLLATE NOCASE LIMIT 1`,
  ).get(name, name) as
    { uuid: string; global_name: string; country: string | null; rank: number | null; total_points: number | null } | undefined
  if (aredl) {
    out.push({
      source: 'aredl', label: 'AREDL', to: `/aredl-players/${aredl.uuid}`,
      name: aredl.global_name, country: aredl.country, rank: aredl.rank, points: aredl.total_points,
    })
  }

  const pc = db.prepare(
    `SELECT pc_id, name, nationality, rank, score FROM pointercrate_players
      WHERE name = ? COLLATE NOCASE AND banned = 0 LIMIT 1`,
  ).get(name) as
    { pc_id: number; name: string; nationality: string | null; rank: number | null; score: number | null } | undefined
  if (pc) {
    out.push({
      source: 'pointercrate', label: 'Pointercrate', to: `/pointercrate-players/${pc.pc_id}`,
      name: pc.name, country: pc.nationality, rank: pc.rank, points: pc.score,
    })
  }

  const gdl = db.prepare(
    `SELECT gdl_id, username, country, placement, points FROM gdl_players
      WHERE username = ? COLLATE NOCASE AND is_banned = 0 LIMIT 1`,
  ).get(name) as
    { gdl_id: number; username: string; country: string | null; placement: number | null; points: number | null } | undefined
  if (gdl) {
    out.push({
      source: 'gdl', label: 'GDL', to: `/gdl-players/${gdl.gdl_id}`,
      name: gdl.username, country: gdl.country, rank: gdl.placement, points: gdl.points,
    })
  }

  return out
}

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
      external: externalProfiles(db, sheetPlayer.name),
      follow: followInfo(db, event, sheetPlayer.name),
    }
  }

  // Not on the leaderboard — try to derive stats from accepted records.
  const stats = computeDerivedStats(db, playerName)

  // No leaderboard row AND no accepted records. If a registered account with
  // this username exists, hand the client a `claimedBy` so it can redirect to
  // /users/<username> rather than show a 404. Without this, leaderboard /
  // feed links to players who don't have any list points get stuck on
  // /users/by-player/<name>.
  if (!stats) {
    const acc = db.prepare(
      `SELECT username FROM accounts WHERE username = ? COLLATE NOCASE`,
    ).get(playerName) as { username: string } | undefined
    if (acc) {
      return {
        player: { name: acc.username, total_points: 0, skill_points: 0, hardest: null, tier: null, country: null },
        claimedBy: acc.username,
        derived: true,
        completedLevels: [],
        createdLevels: [],
        external: externalProfiles(db, acc.username),
        follow: followInfo(db, event, acc.username),
      }
    }

    // Known only to another list. This used to 404, which is why leaderboard
    // rows for those players had to point at the external site instead of at a
    // profile here. They have an ALL standing — it is zero — and saying so is
    // an answer; bouncing someone off the site is not.
    const ext = externalProfiles(db, playerName)
    if (ext.length) {
      return {
        player: { name: ext[0]!.name, total_points: 0, skill_points: 0, hardest: null, tier: null, country: ext[0]!.country },
        claimedBy: null,
        derived: true,
        completedLevels: [],
        createdLevels: [],
        external: ext,
        follow: followInfo(db, event, ext[0]!.name),
      }
    }
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
    external: externalProfiles(db, stats.name),
    follow: followInfo(db, event, stats.name),
  }
})

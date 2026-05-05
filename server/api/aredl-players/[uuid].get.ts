import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'

/**
 * Aredl player profile. Combines our cached snapshot from the Aredl
 * leaderboard with a lazy fetch of /api/aredl/profile/{id} for description /
 * created / published — fields we don't mirror locally because they'd take
 * 44k extra HTTP requests at import time.
 *
 * Response shape mirrors the legacy /api/users/by-player so the Aredl player
 * profile page can reuse the same components (RecordCharts, ProfileLevelLists)
 * and visual layout.
 *
 * Levels matched to the ALL list (by gd_id) go in completedLevels/createdLevels
 * with their ALL-list position + points + gddl_tier so the existing components
 * render correctly. Levels that exist only on Aredl get split into
 * aredlOnlyCompleted/aredlOnlyCreated.
 */

const PROFILE_CACHE_TTL_MS = 60 * 60 * 1000
const API_BASE = process.env.AREDL_API_BASE || 'https://api.aredl.net/v2/api/aredl'

type AredlLevelRef = { id: string; level_id: number; name: string; position: number; legacy: boolean }
type AredlProfile = {
  description: string | null
  created: AredlLevelRef[]
  published: AredlLevelRef[]
}

async function fetchAredlProfile(uuid: string): Promise<AredlProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/profile/${uuid}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as AredlProfile
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const uuid = String(getRouterParam(event, 'uuid') ?? '').trim()
  if (!uuid) throw createError({ statusCode: 400, statusMessage: 'uuid required' })

  const db = getDb()
  const player = db.prepare(
    `SELECT ap.uuid, ap.username, ap.global_name, ap.description, ap.country, ap.discord_id,
            ap.total_points, ap.pack_points, ap.extremes, ap.rank, ap.hardest_uuid, ap.hardest_name,
            ap.claimed_account_id, ap.fetched_at,
            a.username AS claimed_username, a.role AS claimed_role
       FROM aredl_players ap
       LEFT JOIN accounts a ON a.id = ap.claimed_account_id
      WHERE ap.uuid = ?`,
  ).get(uuid) as any

  if (!player) throw createError({ statusCode: 404, statusMessage: 'Aredl player not found' })

  // Lazy-fetch description / created / published (1h TTL on description).
  let description: string | null = player.description
  let liveCreated: AredlLevelRef[] = []
  let livePublished: AredlLevelRef[] = []

  const fetchedMs = player.fetched_at ? Date.parse(player.fetched_at) : 0
  const stale = !description || (Date.now() - fetchedMs) > PROFILE_CACHE_TTL_MS
  if (stale) {
    const live = await fetchAredlProfile(uuid)
    if (live) {
      description = live.description ?? null
      liveCreated = live.created ?? []
      livePublished = live.published ?? []
      db.prepare(`UPDATE aredl_players SET description = ?, fetched_at = ? WHERE uuid = ?`)
        .run(description, new Date().toISOString(), uuid)
    }
  }

  // Records — joined to ALL levels (by gd_id) when possible. Records on
  // Aredl-only levels are split out so the main component renders only
  // ALL-list rows (which is what its tier-color column needs).
  const allRecords = db.prepare(
    `SELECT l.position, l.name, l.points, l.gddl_tier, 100 AS percent,
            ar.video_url, ar.is_verification, ar.achieved_at
       FROM aredl_records ar
       JOIN levels l ON l.gd_id = ar.level_gd_id
      WHERE ar.player_uuid = ?
      ORDER BY l.position ASC`,
  ).all(uuid) as Array<{ position: number; name: string; points: number | null; gddl_tier: string | null; percent: number; video_url: string; is_verification: number; achieved_at: string }>

  const aredlOnlyRecords = db.prepare(
    `SELECT al.position AS aredl_position, al.name, al.points, al.gddl_tier,
            ar.video_url, ar.is_verification, ar.achieved_at
       FROM aredl_records ar
       JOIN aredl_levels al ON al.gd_id = ar.level_gd_id
      WHERE ar.player_uuid = ?
      ORDER BY al.position ASC`,
  ).all(uuid) as Array<{ aredl_position: number; name: string; points: number | null; gddl_tier: string | null; video_url: string; is_verification: number; achieved_at: string }>

  // Created levels: join Aredl's per-profile list against our levels table by
  // gd_id so each row carries an ALL-list position. Levels that aren't on the
  // ALL list still surface in aredlOnlyCreated.
  const allCreated: Array<{ position: number; name: string; points: number | null; gddl_tier: string | null }> = []
  const aredlOnlyCreated: Array<{ aredl_position: number; name: string; points: number | null; gddl_tier: string | null }> = []
  if (liveCreated.length) {
    const findInAll = db.prepare(`SELECT position, name, points, gddl_tier FROM levels WHERE gd_id = ?`)
    const findAredlOnly = db.prepare(`SELECT position, name, points, gddl_tier FROM aredl_levels WHERE gd_id = ?`)
    for (const lvl of liveCreated) {
      const inAll = findInAll.get(lvl.level_id) as any
      if (inAll) {
        allCreated.push(inAll)
      } else {
        const inAredl = findAredlOnly.get(lvl.level_id) as any
        if (inAredl) {
          aredlOnlyCreated.push({ aredl_position: inAredl.position, name: inAredl.name, points: inAredl.points, gddl_tier: inAredl.gddl_tier ? String(inAredl.gddl_tier) : null })
        } else {
          aredlOnlyCreated.push({ aredl_position: lvl.position, name: lvl.name, points: null, gddl_tier: null })
        }
      }
    }
  }

  // Country reverse-lookup of the local accounts country we'd display next to
  // the name follows the same alpha-2 contract as the rest of the site.
  const country = countryNumericToAlpha2(player.country)

  return {
    player: {
      name: player.global_name,
      country,
      total_points: player.total_points,
      pack_points: player.pack_points,
      extremes: player.extremes,
      hardest: player.hardest_name,
      rank: player.rank,
      // ProfileLevelLists / RecordCharts ignore these on the Aredl page; kept
      // for shape parity with /api/users/by-player so the Vue templates match.
      skill_points: 0,
      tier: null,
    },
    description,
    discord_id: player.discord_id,
    claimedBy: player.claimed_username ?? null,
    completedLevels: allRecords,
    aredlOnlyCompleted: aredlOnlyRecords,
    createdLevels: allCreated,
    aredlOnlyCreated,
    publishedCount: livePublished.length,
  }
})

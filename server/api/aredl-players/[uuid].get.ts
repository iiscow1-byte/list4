import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'

/**
 * Aredl player profile. Combines our cached snapshot of the player from the
 * Aredl leaderboard with a lazy fetch of the live /api/aredl/profile/{id}
 * endpoint for description / created / published levels — fields we don't
 * mirror locally because they'd take 44k extra HTTP requests at import time.
 *
 * Lazy-fetched fields are cached on the aredl_players row for an hour so the
 * profile page stays responsive without hammering Aredl's API.
 */

const PROFILE_CACHE_TTL_MS = 60 * 60 * 1000

const API_BASE = process.env.AREDL_API_BASE || 'https://api.aredl.net/v2/api/aredl'

type AredlProfile = {
  id: string
  username: string
  global_name: string
  description: string | null
  country: number | null
  discord_id: string | null
  created: Array<{ id: string; level_id: number; name: string; position: number; legacy: boolean }>
  published: Array<{ id: string; level_id: number; name: string; position: number; legacy: boolean }>
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

  // Cache description / created / published on the row. The "stale" check
  // looks at fetched_at — refreshed at most once an hour.
  let description: string | null = player.description
  let created: AredlProfile['created'] = []
  let published: AredlProfile['published'] = []

  const fetchedMs = player.fetched_at ? Date.parse(player.fetched_at) : 0
  const stale = !description || (Date.now() - fetchedMs) > PROFILE_CACHE_TTL_MS

  if (stale) {
    const live = await fetchAredlProfile(uuid)
    if (live) {
      description = live.description ?? null
      created = live.created ?? []
      published = live.published ?? []
      db.prepare(`UPDATE aredl_players SET description = ?, fetched_at = ? WHERE uuid = ?`)
        .run(description, new Date().toISOString(), uuid)
    }
  }

  // Records this player has on Aredl. Joined to local levels rows when the
  // gd_id matches so the UI can link directly to the ALL-list level page.
  const records = db.prepare(
    `SELECT ar.video_url, ar.is_verification, ar.mobile, ar.achieved_at,
            ar.level_gd_id, l.position AS list_position, l.name AS level_name,
            al.position AS aredl_only_position, al.name AS aredl_only_name
       FROM aredl_records ar
       LEFT JOIN levels       l  ON l.gd_id  = ar.level_gd_id
       LEFT JOIN aredl_levels al ON al.gd_id = ar.level_gd_id
      WHERE ar.player_uuid = ?
      ORDER BY ar.achieved_at DESC`,
  ).all(uuid)

  return {
    uuid: player.uuid,
    username: player.username,
    global_name: player.global_name,
    description,
    country: countryNumericToAlpha2(player.country),
    discord_id: player.discord_id,
    total_points: player.total_points,
    pack_points: player.pack_points,
    extremes: player.extremes,
    rank: player.rank,
    hardest: player.hardest_name ? { uuid: player.hardest_uuid, name: player.hardest_name } : null,
    claimed_account: player.claimed_username
      ? { username: player.claimed_username, role: player.claimed_role }
      : null,
    records,
    created,
    published,
  }
})

import { getDb } from '~/server/db'

/**
 * Pointercrate player profile. Mirrors the response shape of the Aredl
 * player API so the page component can reuse the same RecordCharts /
 * ProfileLevelLists layout.
 *
 * Records are joined back to local levels by gd_id when possible. Records on
 * legacy Pointercrate demons (which usually aren't on the ALL list) are
 * surfaced separately so the main "Levels Completed" list stays clickable
 * with valid ALL-list positions.
 */

export default defineEventHandler((event) => {
  const pcIdRaw = String(getRouterParam(event, 'pc_id') ?? '').trim()
  const pcId = Number(pcIdRaw)
  if (!Number.isFinite(pcId) || pcId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'pc_id required' })
  }

  const db = getDb()
  const player = db.prepare(
    `SELECT pp.pc_id, pp.name, pp.banned, pp.nationality, pp.subdivision,
            pp.rank, pp.score, pp.hardest_pc_id, pp.hardest_name,
            pp.claimed_account_id,
            a.username AS claimed_username, a.role AS claimed_role
       FROM pointercrate_players pp
       LEFT JOIN accounts a ON a.id = pp.claimed_account_id
      WHERE pp.pc_id = ?`,
  ).get(pcId) as any

  if (!player) throw createError({ statusCode: 404, statusMessage: 'Pointercrate player not found' })

  // Records that map to ALL-list rows (clickable, gddl_tier-colored).
  const completedLevels = db.prepare(
    `SELECT l.position, l.name, l.points, l.gddl_tier,
            pcr.progress AS percent
       FROM pointercrate_records pcr
       JOIN levels l ON l.gd_id = pcr.level_gd_id
      WHERE pcr.player_pc_id = ?
      ORDER BY l.position ASC`,
  ).all(pcId)

  // Records on Pointercrate demons that aren't on the ALL list (typically
  // legacy demons whose level_id is missing from our levels table).
  const offListCompleted = db.prepare(
    `SELECT pcr.demon_position AS pc_position, pcr.demon_name AS name,
            pcr.progress AS percent, pcr.is_legacy, pcr.video, pcr.is_verification
       FROM pointercrate_records pcr
       LEFT JOIN levels l ON l.gd_id = pcr.level_gd_id
      WHERE pcr.player_pc_id = ?
        AND l.id IS NULL
      ORDER BY pcr.demon_position ASC`,
  ).all(pcId)

  const sortedByPts = [...(completedLevels as Array<{ points: number | null }>)].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  const allTotalPoints = sortedByPts.reduce((s, r) => s + (r.points ?? 0), 0)
  const allSkillPoints = sortedByPts.reduce((s, r, i) => s + (r.points ?? 0) * Math.pow(0.95, i), 0)

  return {
    player: {
      name: player.name,
      country: player.nationality,
      subdivision: player.subdivision,
      total_points: allTotalPoints,
      pack_points: 0,
      extremes: 0,
      hardest: player.hardest_name,
      rank: player.rank,
      banned: !!player.banned,
      skill_points: allSkillPoints,
      tier: null,
    },
    description: null,
    discord_id: null,
    claimedBy: player.claimed_username ?? null,
    completedLevels,
    offListCompleted,
    createdLevels: [],
    publishedCount: 0,
  }
})

import { getDb } from '~/server/db'

/**
 * GDL player profile. Mirrors the response shape of the AREDL/PC player APIs
 * so the page component can reuse the same RecordCharts / ProfileLevelLists
 * layout.
 *
 * Records are joined back to local levels by gd_id when possible. Records on
 * GDL-only levels (not on the ALL list) get split out so the main "Levels
 * Completed" list stays clickable with valid ALL-list positions.
 *
 * Levels with `percent < 100` are progress entries — surfaced as off-list
 * progress so the page doesn't claim a partial run as a completion.
 */

export default defineEventHandler((event) => {
  const idRaw = String(getRouterParam(event, 'id') ?? '').trim()
  const gdlId = Number(idRaw)
  if (!Number.isFinite(gdlId) || gdlId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'id required' })
  }

  const db = getDb()
  const player = db.prepare(
    `SELECT gp.gdl_id, gp.username, gp.country, gp.badge, gp.is_banned,
            gp.placement, gp.points, gp.hardest_gdl_id, gp.hardest_name,
            gp.claimed_account_id,
            a.username AS claimed_username, a.role AS claimed_role
       FROM gdl_players gp
       LEFT JOIN accounts a ON a.id = gp.claimed_account_id
      WHERE gp.gdl_id = ?`,
  ).get(gdlId) as any

  if (!player) throw createError({ statusCode: 404, statusMessage: 'GDL player not found' })

  // 100% records on ALL-list rows.
  const completedLevels = db.prepare(
    `SELECT l.position, l.name, l.points, l.gddl_tier,
            gr.percent
       FROM gdl_records gr
       JOIN levels l ON l.gd_id = gr.level_gd_id
      WHERE gr.player_gdl_id = ? AND gr.percent = 100
      ORDER BY l.position ASC`,
  ).all(gdlId)

  // 100% records on GDL levels not on the ALL list.
  const offListCompleted = db.prepare(
    `SELECT gl.placement AS gdl_position, gl.name, gl.points, gl.list_type,
            gr.percent, gr.video_url, gr.is_verification
       FROM gdl_records gr
       JOIN gdl_levels gl ON gl.gdl_id = gr.level_gdl_id
       LEFT JOIN levels l ON l.gd_id = gl.gd_id
      WHERE gr.player_gdl_id = ? AND gr.percent = 100 AND l.id IS NULL
      ORDER BY gl.placement ASC`,
  ).all(gdlId)

  const sortedByPts = [...(completedLevels as Array<{ points: number | null }>)].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  const allTotalPoints = sortedByPts.reduce((s, r) => s + (r.points ?? 0), 0)
  const allSkillPoints = sortedByPts.reduce((s, r, i) => s + (r.points ?? 0) * Math.pow(0.95, i), 0)

  return {
    player: {
      name: player.username,
      country: player.country,
      total_points: allTotalPoints,
      pack_points: 0,
      extremes: 0,
      hardest: player.hardest_name,
      rank: player.placement,
      banned: !!player.is_banned,
      badge: player.badge,
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

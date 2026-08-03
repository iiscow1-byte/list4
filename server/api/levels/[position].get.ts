import { getDb } from '~/server/db'
import { communityStats } from '~/server/utils/opinions'
import { countryNumericToAlpha2 } from '~/utils/country-codes'
import { challengeSourceSqlExpr } from '~/utils/challenge-sources'
import { otherListsFor } from '~/server/utils/other-lists'

const IS_CHALLENGE_L = `(${challengeSourceSqlExpr('l.placement_source')} OR l.rated = 'Challenge' OR ((l.rated IS NULL OR l.rated = '') AND json_extract(c.info_json, '$.score') = 0 AND json_extract(c.info_json, '$.length') IN ('Tiny', 'Short') AND l.gddl_tier LIKE 'Tier %'))`
const IS_CHALLENGE_L2 = `(${challengeSourceSqlExpr('l2.placement_source')} OR l2.rated = 'Challenge' OR ((l2.rated IS NULL OR l2.rated = '') AND json_extract(c2.info_json, '$.score') = 0 AND json_extract(c2.info_json, '$.length') IN ('Tiny', 'Short') AND l2.gddl_tier LIKE 'Tier %'))`

export default defineEventHandler((event) => {
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const db = getDb()
  const level = db.prepare(`SELECT * FROM levels WHERE position = ?`).get(position) as any
  if (!level) throw createError({ statusCode: 404, statusMessage: 'Level not found' })

  // Resolve the submitter's username (only set for site submissions; sheet
  // imports have submitted_by = NULL).
  const submitter = level.submitted_by
    ? (db.prepare(`SELECT username FROM accounts WHERE id = ?`).get(level.submitted_by) as { username: string } | undefined)?.username ?? null
    : null

  const records = db
    .prepare(
      `SELECT r.id, r.percent, r.hz, r.video, r.player_name AS player, p.country, 'all' AS source
       FROM records r
       LEFT JOIN players p ON p.id = r.player_id
       WHERE r.level_id = ? AND r.permanent = 1
       ORDER BY r.percent DESC, r.player_name COLLATE NOCASE ASC`,
    )
    .all(level.id)

  // External-list records for this level (matched by gd_id). The Pointercrate
  // importer no longer dedups at insert time, so the same player's completion
  // can appear across `records` / `aredl_records` / `pointercrate_records` —
  // most often when one site account has claimed both an AREDL and a
  // Pointercrate profile. We dedup below before returning.
  const aredl_records = level.gd_id
    ? (db
        .prepare(
          `SELECT 100 AS percent,
                  NULL AS hz,
                  ar.video_url AS video,
                  ar.player_name AS player,
                  ap.country AS country_numeric,
                  'aredl' AS source,
                  ar.is_verification AS is_verification,
                  ar.mobile,
                  ar.achieved_at
             FROM aredl_records ar
        LEFT JOIN aredl_players ap ON ap.uuid = ar.player_uuid
            WHERE ar.level_gd_id = ?
            ORDER BY ar.achieved_at DESC`,
        )
        .all(level.gd_id) as any[])
        .map((r) => ({
          ...r,
          country: countryNumericToAlpha2(r.country_numeric),
          country_numeric: undefined,
        }))
    : []

  const pointercrate_records = level.gd_id
    ? db
        .prepare(
          `SELECT pcr.progress AS percent,
                  NULL AS hz,
                  pcr.video,
                  pcr.player_name AS player,
                  pp.nationality AS country,
                  'pointercrate' AS source,
                  pcr.is_verification,
                  pcr.is_legacy,
                  pcr.demon_position AS demon_position
             FROM pointercrate_records pcr
        LEFT JOIN pointercrate_players pp ON pp.pc_id = pcr.player_pc_id
            WHERE pcr.level_gd_id = ?
            ORDER BY pcr.progress DESC, pcr.player_name COLLATE NOCASE ASC`,
        )
        .all(level.gd_id)
    : []

  // Cross-source record dedup: keep one entry per (player, percent) with
  // priority ALL > AREDL > Pointercrate. The ALL list row carries the most
  // editorial metadata (hz, video chosen by submitter), so it wins; AREDL
  // beats PC for the same reason. Records arrays already came back sorted,
  // and we filter in-place to preserve that order.
  const seenPlayer = new Set<string>()
  for (const r of records as any[]) seenPlayer.add(`${(r.player as string).toLowerCase()}|${r.percent}`)
  const dedupedAredl = (aredl_records as any[]).filter((r) => {
    const k = `${(r.player as string).toLowerCase()}|${r.percent}`
    if (seenPlayer.has(k)) return false
    seenPlayer.add(k)
    return true
  })
  const dedupedPc = (pointercrate_records as any[]).filter((r) => {
    const k = `${(r.player as string).toLowerCase()}|${r.percent}`
    if (seenPlayer.has(k)) return false
    seenPlayer.add(k)
    return true
  })

  const community = communityStats(db, 'main', level.id)
  // If the community has settled on an enjoyment, prefer it over the imported
  // sheet value for display purposes.
  const enjoyment = community.community_enjoyment ?? level.enjoyment

  // This level's own movements. Imported AREDL history is excluded on purpose:
  // it describes another site's ranking, and it has the graph below to itself.
  // `*_placement` maps each internal position through whichever level sits
  // there now, so the history speaks the numbers the site prints.
  const position_history = db
    .prepare(
      `SELECT h.id, h.from_position, h.to_position, h.changed_at,
              (SELECT sheet_placement FROM levels WHERE position = h.from_position) AS from_placement,
              (SELECT sheet_placement FROM levels WHERE position = h.to_position)   AS to_placement,
              a.username AS changed_by
       FROM position_history h
       LEFT JOIN accounts a ON a.id = h.changed_by
       WHERE h.level_id = ? AND h.source <> 'aredl'
       ORDER BY h.changed_at DESC, h.id DESC`,
    )
    .all(level.id)

  // Full AREDL placement trace (every event, including passive shifts) —
  // powers the position-over-time graph. Oldest-first for charting.
  const aredl_history = db
    .prepare(
      `SELECT event, aredl_position, all_position, position_diff, legacy, cause_name, action_at
       FROM aredl_position_history
       WHERE level_id = ?
       ORDER BY action_at ASC, id ASC`,
    )
    .all(level.id)

  // Resolve duplicate_of_id / alternate_of_id (stored as the original level's
  // levels.id) into the current position + name so the public Duplicate /
  // Alternate tag chips can render a link that survives reordering.
  function resolveOriginal(id: number | null) {
    if (!id) return null
    const r = db
      .prepare(`SELECT position, name FROM levels WHERE id = ?`)
      .get(id) as { position: number; name: string } | undefined
    return r ?? null
  }
  const duplicate_of = resolveOriginal(level.duplicate_of_id ?? null)
  const alternate_of = resolveOriginal(level.alternate_of_id ?? null)

  // Aredl tags (already a JSON array string from the importer). Returned as a
  // separate array so the client can render them alongside its own tags. The
  // ALL list doesn't currently have a level-tags column — there's just the
  // tag *chips* the LevelDetail component derives from gddl_tier / difficulty
  // / skillset / etc. The client merges these for display + dedups by
  // case-insensitive label so tags that already appear as chips don't repeat.
  let aredl_tags: string[] = []
  if (level.aredl_tags) {
    try {
      const parsed = JSON.parse(level.aredl_tags)
      if (Array.isArray(parsed)) aredl_tags = parsed.filter((s) => typeof s === 'string')
    } catch { /* ignore malformed JSON */ }
  }

  // Fractional position within the level's GDDL tier. Higher value = harder
  // (closer to the next tier up). Used to render a decimal like "20.75".
  let gddl_tier_frac: number | null = null
  if (level.gddl_tier) {
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM levels WHERE gddl_tier = ?`).get(level.gddl_tier) as { n: number }).n
    if (total > 0) {
      const easier = (db.prepare(`SELECT COUNT(*) AS n FROM levels WHERE gddl_tier = ? AND position > ?`).get(level.gddl_tier, level.position) as { n: number }).n
      gddl_tier_frac = easier / total
    }
  }

  // "Other lists" rankings — the level's position on every list this site
  // mirrors, including the GDListTemplate ones (CCL, EDI, TSL, …) that only
  // exist in `gdtpl_levels` and used to be missing from this page entirely.
  const other_lists = otherListsFor(db, level)

  const challengeRow = db.prepare(
    `SELECT CASE WHEN ${IS_CHALLENGE_L}
       THEN (SELECT COUNT(*) FROM levels l2 LEFT JOIN gd_info_cache c2 ON c2.gd_id = l2.gd_id WHERE ${IS_CHALLENGE_L2} AND l2.position <= l.position)
       ELSE NULL
     END AS challenge_rank
     FROM levels l LEFT JOIN gd_info_cache c ON c.gd_id = l.gd_id
     WHERE l.position = ?`,
  ).get(position) as { challenge_rank: number | null } | undefined
  const challenge_rank = challengeRow?.challenge_rank ?? null

  return {
    ...level,
    enjoyment,
    records,
    aredl_records: dedupedAredl,
    pointercrate_records: dedupedPc,
    aredl_tags,
    other_lists,
    community,
    position_history,
    aredl_history,
    submitter,
    duplicate_of,
    alternate_of,
    gddl_tier_frac,
    challenge_rank,
  }
})

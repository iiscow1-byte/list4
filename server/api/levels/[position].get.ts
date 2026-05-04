import { getDb } from '~/server/db'
import { communityStats } from '~/server/utils/opinions'

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
      `SELECT r.percent, r.hz, r.video, r.player_name AS player, p.country, 'all' AS source
       FROM records r
       LEFT JOIN players p ON p.id = r.player_id
       WHERE r.level_id = ? AND r.permanent = 1
       ORDER BY r.percent DESC, r.player_name COLLATE NOCASE ASC`,
    )
    .all(level.id)

  // Aredl records for this level (matched by gd_id). The importer already
  // dropped any record with an exact-match (player_name + gd_id) in the ALL
  // records, so concatenating is safe — the dedup happened upstream.
  const aredl_records = level.gd_id
    ? db
        .prepare(
          `SELECT 100 AS percent,
                  NULL AS hz,
                  ar.video_url AS video,
                  ar.player_name AS player,
                  ap.country,
                  'aredl' AS source,
                  ar.is_verification AS is_verification,
                  ar.mobile,
                  ar.achieved_at
             FROM aredl_records ar
        LEFT JOIN aredl_players ap ON ap.uuid = ar.player_uuid
            WHERE ar.level_gd_id = ?
            ORDER BY ar.achieved_at DESC`,
        )
        .all(level.gd_id)
    : []

  const community = communityStats(db, 'main', level.id)
  // If the community has settled on an enjoyment, prefer it over the imported
  // sheet value for display purposes.
  const enjoyment = community.community_enjoyment ?? level.enjoyment

  const position_history = db
    .prepare(
      `SELECT h.id, h.from_position, h.to_position, h.changed_at, a.username AS changed_by
       FROM position_history h
       LEFT JOIN accounts a ON a.id = h.changed_by
       WHERE h.level_id = ?
       ORDER BY h.changed_at DESC, h.id DESC`,
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

  // "Other lists" rankings — the level's position on every external list we
  // mirror. Currently just Aredl; future list integrations slot in here.
  const other_lists: Array<{ list: string; position: number; url?: string | null }> = []
  if (level.aredl_position != null) {
    other_lists.push({
      list: 'AREDL',
      position: level.aredl_position,
      url: level.gd_id ? `https://aredl.net/level/${level.gd_id}` : null,
    })
  }

  return {
    ...level,
    enjoyment,
    records,
    aredl_records,
    aredl_tags,
    other_lists,
    community,
    position_history,
    submitter,
    duplicate_of,
    alternate_of,
  }
})

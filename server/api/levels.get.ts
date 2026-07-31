import { getDb } from '~/server/db'
import { challengeSourceSqlExpr } from '~/utils/challenge-sources'

const TIER_ORD_SQL = `
  CASE
    WHEN gddl_tier LIKE 'Subtier %' THEN CAST(SUBSTR(gddl_tier, 9) AS INTEGER)
    WHEN gddl_tier LIKE 'Tier %'    THEN 5 + CAST(SUBSTR(gddl_tier, 6) AS INTEGER)
  END
`

// Sources that always classify a level as Challenge regardless of `rated`.
const SOURCE_CHALLENGE_SQL = challengeSourceSqlExpr('placement_source')

// CTE that computes challenge rank (1-based position among challenges only,
// ordered by list position ascending) for every challenge level. Uses lc/cc
// aliases so it doesn't conflict with the main query's levels/c aliases.
// Replace c.info_json → cc.info_json; other columns (rated, placement_source,
// gddl_tier) are unambiguous within the CTE because gd_info_cache lacks them.

// Whether a level is a "Challenge" — three independent reasons:
//   1) placement_source is one of the curated challenge-list sources;
//   2) admin/sheet pinned `rated = 'Challenge'`;
//   3) GD API reports unrated (score 0) + Tiny/Short length, and the level
//      sits at Tier 1+ on this list (Subtiers don't qualify).
// Reasons (1) and (2) override any other `rated` value. Returns 0/1 (never
// NULL) so it's safe to AND/NOT against.
const IS_CHALLENGE_SQL = `
  COALESCE(
    ${SOURCE_CHALLENGE_SQL}
    OR rated = 'Challenge'
    OR ((rated IS NULL OR rated = '')
        AND json_extract(c.info_json, '$.score') = 0
        AND json_extract(c.info_json, '$.length') IN ('Tiny', 'Short')
        AND gddl_tier LIKE 'Tier %'),
    0
  )
`

// Effective rating name for a level. The stored `rated` column only carries
// admin/sheet overrides (and the 'Challenge' pin) — every other tiered rating
// is sourced from the cached GD API response (info_json.score). Mirror the
// same fallback chain used by /api/stats and LevelDetail's ratedLabel so
// filters and sorts agree with what the user sees on the level page.
//   score 5 → Mythic, 4 → Legendary, 3 → Epic, 2 → Featured, 1 → Rated, 0/null → Unrated
const EFFECTIVE_RATED_SQL = `
  CASE
    WHEN ${IS_CHALLENGE_SQL} THEN 'Challenge'
    WHEN rated IS NOT NULL AND rated <> '' THEN rated
    WHEN json_extract(c.info_json, '$.score') = 5 THEN 'Mythic'
    WHEN json_extract(c.info_json, '$.score') = 4 THEN 'Legendary'
    WHEN json_extract(c.info_json, '$.score') = 3 THEN 'Epic'
    WHEN json_extract(c.info_json, '$.score') = 2 THEN 'Featured'
    WHEN json_extract(c.info_json, '$.score') = 1 THEN 'Rated'
    ELSE 'Unrated'
  END
`

// Numeric ladder for rating sorts. Higher number = "more rated"
// (Mythic > Legendary > Epic > Featured > Rated > Unrated > Challenge).
const RATING_ORD_SQL = `
  CASE (${EFFECTIVE_RATED_SQL})
    WHEN 'Challenge' THEN 0
    WHEN 'Mythic'    THEN 6
    WHEN 'Legendary' THEN 5
    WHEN 'Epic'      THEN 4
    WHEN 'Featured'  THEN 3
    WHEN 'Rated'     THEN 2
    ELSE 1
  END
`

const SORT_SQL: Record<string, string> = {
  position:           'position ASC',
  name_asc:           'name COLLATE NOCASE ASC',
  verify_desc:        "COALESCE(verify_date,'') DESC, position ASC",
  verify_asc:         "COALESCE(verify_date,'9999') ASC, position ASC",
  enjoyment_desc:     'enjoyment DESC NULLS LAST, position ASC',
  enjoyment_asc:      'enjoyment ASC NULLS LAST, position ASC',
  added_desc:         'id DESC',
  added_asc:          'id ASC',
  rating_desc:        `(${RATING_ORD_SQL}) DESC, position ASC`,
  rating_asc:         `(${RATING_ORD_SQL}) ASC, position ASC`,
  aredl_asc:          'aredl_position ASC NULLS LAST, position ASC',
  pointercrate_asc:   'pointercrate_position ASC NULLS LAST, position ASC',
  gdl_asc:            'gdl_position ASC NULLS LAST, position ASC',
  cl_asc:             'challenge_list_position ASC NULLS LAST, position ASC',
}

const KNOWN_TAG_SUFFIXES = new Set(['old', 'uldm', 'buffed', 'nerfed'])
const KNOWN_RATINGS = new Set(['Challenge', 'Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'])
const TIERED_RATING_LEVEL: Record<string, number> = {
  Rated: 1, Featured: 2, Epic: 3, Legendary: 4, Mythic: 5,
}
const TIERED_RATING_NAMES = Object.keys(TIERED_RATING_LEVEL)

function asArray(v: any): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String)
  return String(v).split(',').map((s) => s.trim()).filter(Boolean)
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(500, Math.max(1, Number(q.pageSize) || 100))
  const rawSearch = typeof q.search === 'string' ? q.search.trim() : ''
  const searchTerms = rawSearch ? rawSearch.split(',').map((s) => s.trim()).filter(Boolean) : []
  const offset = (page - 1) * pageSize

  const tierMin = q.tierMin != null && q.tierMin !== '' ? Number(q.tierMin) : null
  const tierMax = q.tierMax != null && q.tierMax !== '' ? Number(q.tierMax) : null
  const tags = asArray(q.tags).map((s) => s.toLowerCase()).filter((s) => KNOWN_TAG_SUFFIXES.has(s))
  const skillsets = asArray(q.skillsets).map((s) => s.trim()).filter(Boolean)
  // 'show' (default) | 'hide' | 'only' for same_as_above ("Duplicate" tag).
  // Param name kept as `altVersions` for backwards compatibility with bookmarks.
  const altVersions = q.altVersions === 'hide' || q.altVersions === 'only' ? q.altVersions : 'show'
  // Same tri-state for the new `is_alternate` flag ("Alternate" tag).
  const alternates = q.alternates === 'hide' || q.alternates === 'only' ? q.alternates : 'show'
  // Tri-state filter for levels flagged as tentative placements.
  const tentativePlacements = q.tentativePlacements === 'hide' || q.tentativePlacements === 'only' ? q.tentativePlacements : 'show'
  const creator = typeof q.creator === 'string' ? q.creator.trim() : ''
  const source = typeof q.source === 'string' ? q.source.trim() : ''
  const verifyFrom = typeof q.verifyFrom === 'string' ? q.verifyFrom.trim() : ''
  const verifyTo = typeof q.verifyTo === 'string' ? q.verifyTo.trim() : ''
  const ratings = asArray(q.ratings).filter((s) => KNOWN_RATINGS.has(s))
  const enjoyMin = q.enjoyMin != null && q.enjoyMin !== '' ? Number(q.enjoyMin) : null
  const enjoyMax = q.enjoyMax != null && q.enjoyMax !== '' ? Number(q.enjoyMax) : null
  const sort = typeof q.sort === 'string' && SORT_SQL[q.sort] ? q.sort : 'position'
  const rankByFilter = q.rankByFilter === '1' || q.rankByFilter === 'true' || q.rankByFilter === true
  const externalList = typeof q.externalList === 'string' ? q.externalList.trim().toLowerCase() : ''
  const tierFrac = q.tierFrac === '1' || q.tierFrac === 'true'

  // Filter conditions are split in two so the optional rank-by-filter mode can
  // compute rank from the filter-only set and apply the text search separately
  // on top — searching narrows the displayed rows but doesn't change their
  // ranks within the filtered list.
  const filterConds: string[] = []
  const filterParams: any[] = []
  const searchConds: string[] = []
  const searchParams: any[] = []

  if (searchTerms.length > 0) {
    const orParts: string[] = []
    for (const term of searchTerms) {
      const asPos = Number(term.replace(/^#/, ''))
      if (Number.isInteger(asPos) && asPos > 0) {
        orParts.push('name LIKE ? COLLATE NOCASE OR position = ?')
        searchParams.push(`%${term}%`, asPos)
      } else {
        orParts.push('name LIKE ? COLLATE NOCASE')
        searchParams.push(`%${term}%`)
      }
    }
    searchConds.push(`(${orParts.join(' OR ')})`)
  }

  if (Number.isFinite(tierMin)) { filterConds.push(`(${TIER_ORD_SQL}) >= ?`); filterParams.push(tierMin) }
  if (Number.isFinite(tierMax)) { filterConds.push(`(${TIER_ORD_SQL}) <= ?`); filterParams.push(tierMax) }

  for (const tag of tags) {
    const label = tag === 'uldm' ? 'ULDM' : tag.charAt(0).toUpperCase() + tag.slice(1)
    filterConds.push(`name LIKE ? COLLATE NOCASE`)
    filterParams.push(`%(${label})%`)
  }

  if (creator) {
    filterConds.push(`creator LIKE ? COLLATE NOCASE`)
    filterParams.push(`%${creator}%`)
  }

  if (source) {
    // Match within pipe-separated multi-source values (e.g. "Demon List|AREDL")
    filterConds.push(`('|' || COALESCE(placement_source, '') || '|') LIKE ?`)
    filterParams.push(`%|${source}|%`)
  }

  if (skillsets.length) {
    filterConds.push(`main_skillset IN (${skillsets.map(() => '?').join(',')})`)
    filterParams.push(...skillsets)
  }

  if (altVersions === 'hide') filterConds.push(`COALESCE(same_as_above, 0) = 0`)
  else if (altVersions === 'only') filterConds.push(`COALESCE(same_as_above, 0) = 1`)

  if (alternates === 'hide') filterConds.push(`COALESCE(is_alternate, 0) = 0`)
  else if (alternates === 'only') filterConds.push(`COALESCE(is_alternate, 0) = 1`)

  if (tentativePlacements === 'hide') filterConds.push(`COALESCE(tentative_placement, 0) = 0`)
  else if (tentativePlacements === 'only') filterConds.push(`COALESCE(tentative_placement, 0) = 1`)

  if (verifyFrom) { filterConds.push(`verify_date >= ?`); filterParams.push(verifyFrom) }
  if (verifyTo)   { filterConds.push(`verify_date <= ?`); filterParams.push(verifyTo) }

  if (ratings.length) {
    // "Featured" means "Featured-or-better" — picking any tiered rating
    // expands upward through the ladder. Challenge / Unrated are buckets in
    // their own right and don't expand.
    const tieredChosen = ratings.filter((r) => TIERED_RATING_LEVEL[r] != null)
    const minLevel = tieredChosen.length
      ? Math.min(...tieredChosen.map((r) => TIERED_RATING_LEVEL[r]!))
      : null
    const expanded = minLevel != null
      ? TIERED_RATING_NAMES.filter((r) => TIERED_RATING_LEVEL[r]! >= minLevel)
      : []

    const buckets: string[] = [...expanded]
    if (ratings.includes('Unrated')) buckets.push('Unrated')
    if (ratings.includes('Challenge')) buckets.push('Challenge')

    filterConds.push(`(${EFFECTIVE_RATED_SQL}) IN (${buckets.map(() => '?').join(',')})`)
    filterParams.push(...buckets)
  }

  if (Number.isFinite(enjoyMin)) { filterConds.push(`enjoyment >= ?`); filterParams.push(enjoyMin) }
  if (Number.isFinite(enjoyMax)) { filterConds.push(`enjoyment <= ?`); filterParams.push(enjoyMax) }

  if (externalList === 'aredl') filterConds.push("aredl_position IS NOT NULL AND difficulty = 'Extreme Demon'")
  else if (externalList === 'pointercrate') filterConds.push('pointercrate_position IS NOT NULL')
  else if (externalList === 'gdl') filterConds.push('gdl_position IS NOT NULL')
  else if (externalList === 'cl') filterConds.push('challenge_list_position IS NOT NULL')

  const challengeOnly = ratings.length === 1 && ratings[0] === 'Challenge'
  // Challenge-only mode has always ranked by filter ordering — keep that
  // implicit so the existing "challenge ranks" UX still works without the
  // explicit toggle.
  const useFilterRank = rankByFilter || challengeOnly

  const orderBySort = SORT_SQL[sort]!
  const orderBy = searchTerms.length > 0
    ? `(${searchTerms.map(() => 'name = ? COLLATE NOCASE').join(' OR ')}) DESC, ${orderBySort}`
    : orderBySort
  const orderParams = [...searchTerms]

  const db = getDb()
  const filterWhere = filterConds.length ? `WHERE ${filterConds.join(' AND ')}` : ''
  const allWhere = [...filterConds, ...searchConds].length
    ? `WHERE ${[...filterConds, ...searchConds].join(' AND ')}`
    : ''
  const allParams = [...filterParams, ...searchParams]

  // gd_info_cache is joined so RATING_ORD_SQL / API_CHALLENGE_SQL can read
  // info_json. PRIMARY KEY on gd_info_cache.gd_id keeps it 1:1 — row count
  // (and COUNT(*)) is unchanged by the join.
  const fromClause = `levels LEFT JOIN gd_info_cache c ON c.gd_id = levels.gd_id`

  const total = (db.prepare(`SELECT COUNT(*) as n FROM ${fromClause} ${allWhere}`).get(...allParams) as { n: number }).n

  // Pre-fetch all challenge level positions (ordered) to compute absolute
  // challenge ranks in JS — avoids window functions in the main query.
  const challengePositions = (db.prepare(
    `SELECT position FROM ${fromClause} WHERE (${IS_CHALLENGE_SQL}) ORDER BY position ASC`,
  ).all() as { position: number }[]).map((r) => r.position)
  const challengeRankMap = new Map<number, number>(
    challengePositions.map((pos, i) => [pos, i + 1]),
  )

  let items: any[]
  if (useFilterRank) {
    // Rank within the filter-only set, then narrow to the search hit list.
    // ROW_NUMBER over the user-selected sort is the displayRank (1-based,
    // independent of pagination offsets).
    const innerSearchClause = searchConds.length ? `WHERE ${searchConds.join(' AND ')}` : ''
    const sql = `
      WITH ranked AS (
        SELECT id, position, name, difficulty, points, gddl_tier, levels.gd_id, creator,
               aredl_position, pointercrate_position, gdl_position, challenge_list_position,
               ROW_NUMBER() OVER (ORDER BY ${orderBySort}) AS displayRank
        FROM ${fromClause}
        ${filterWhere}
      )
      SELECT * FROM ranked
      ${innerSearchClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `
    items = db.prepare(sql).all(
      ...filterParams, ...searchParams, ...orderParams, pageSize, offset,
    ) as any[]
  } else {
    items = db.prepare(
      `SELECT id, position, name, difficulty, points, gddl_tier, levels.gd_id, creator,
              aredl_position, pointercrate_position, gdl_position, challenge_list_position
       FROM ${fromClause}
       ${allWhere}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    ).all(...allParams, ...orderParams, pageSize, offset) as any[]
  }

  // Attach challenge rank and is_challenge flag from the pre-fetched map.
  for (const item of items as any[]) {
    const rank = challengeRankMap.get(item.position)
    item.challenge_rank = rank ?? null
    item.is_challenge = rank != null ? 1 : 0
  }

  if (tierFrac) {
    const uniqueTiers = [...new Set(
      (items as any[]).filter((i) => i.gddl_tier).map((i) => i.gddl_tier as string),
    )]
    const tierPositions = new Map<string, number[]>()
    for (const tier of uniqueTiers) {
      const rows = db.prepare(`SELECT position FROM levels WHERE gddl_tier = ? ORDER BY position ASC`).all(tier) as { position: number }[]
      tierPositions.set(tier, rows.map((r) => r.position))
    }
    for (const item of items as any[]) {
      if (!item.gddl_tier) { item.gddl_tier_frac = null; continue }
      const positions = tierPositions.get(item.gddl_tier)
      if (!positions || positions.length === 0) { item.gddl_tier_frac = null; continue }
      const easier = positions.filter((p) => p > item.position).length
      item.gddl_tier_frac = easier / positions.length
    }
  }

  return { total, page, pageSize, items, challengeMode: challengeOnly, rankByFilter: useFilterRank }
})

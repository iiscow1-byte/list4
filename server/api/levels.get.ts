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

// Numeric ladder for rating sorts. Higher number = "more rated". Mapped against
// the stored `rated` column (Mythic > Legendary > Epic > Featured > Rated >
// Unrated > Challenge). Rows that qualify as Challenge by any of the three
// reasons above sort as Challenge, even if `rated` is set to something else.
const RATING_ORD_SQL = `
  CASE
    WHEN ${IS_CHALLENGE_SQL} THEN 0
    WHEN rated = 'Mythic'    THEN 6
    WHEN rated = 'Legendary' THEN 5
    WHEN rated = 'Epic'      THEN 4
    WHEN rated = 'Featured'  THEN 3
    WHEN rated = 'Rated'     THEN 2
    ELSE 1
  END
`

const SORT_SQL: Record<string, string> = {
  position:        'position ASC',
  name_asc:        'name COLLATE NOCASE ASC',
  verify_desc:     "COALESCE(verify_date,'') DESC, position ASC",
  verify_asc:      "COALESCE(verify_date,'9999') ASC, position ASC",
  enjoyment_desc:  'enjoyment DESC NULLS LAST, position ASC',
  enjoyment_asc:   'enjoyment ASC NULLS LAST, position ASC',
  added_desc:      'id DESC',
  added_asc:       'id ASC',
  rating_desc:     `(${RATING_ORD_SQL}) DESC, position ASC`,
  rating_asc:      `(${RATING_ORD_SQL}) ASC, position ASC`,
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
  const search = typeof q.search === 'string' ? q.search.trim() : ''
  const offset = (page - 1) * pageSize

  const tierMin = q.tierMin != null && q.tierMin !== '' ? Number(q.tierMin) : null
  const tierMax = q.tierMax != null && q.tierMax !== '' ? Number(q.tierMax) : null
  const tags = asArray(q.tags).map((s) => s.toLowerCase()).filter((s) => KNOWN_TAG_SUFFIXES.has(s))
  const skillsets = asArray(q.skillsets).map((s) => s.trim()).filter(Boolean)
  // 'show' (default) | 'hide' | 'only' for same_as_above ("alternate versions").
  const altVersions = q.altVersions === 'hide' || q.altVersions === 'only' ? q.altVersions : 'show'
  const creator = typeof q.creator === 'string' ? q.creator.trim() : ''
  const source = typeof q.source === 'string' ? q.source.trim() : ''
  const verifyFrom = typeof q.verifyFrom === 'string' ? q.verifyFrom.trim() : ''
  const verifyTo = typeof q.verifyTo === 'string' ? q.verifyTo.trim() : ''
  const ratings = asArray(q.ratings).filter((s) => KNOWN_RATINGS.has(s))
  const enjoyMin = q.enjoyMin != null && q.enjoyMin !== '' ? Number(q.enjoyMin) : null
  const enjoyMax = q.enjoyMax != null && q.enjoyMax !== '' ? Number(q.enjoyMax) : null
  const sort = typeof q.sort === 'string' && SORT_SQL[q.sort] ? q.sort : 'position'
  const rankByFilter = q.rankByFilter === '1' || q.rankByFilter === 'true' || q.rankByFilter === true

  // Filter conditions are split in two so the optional rank-by-filter mode can
  // compute rank from the filter-only set and apply the text search separately
  // on top — searching narrows the displayed rows but doesn't change their
  // ranks within the filtered list.
  const filterConds: string[] = []
  const filterParams: any[] = []
  const searchConds: string[] = []
  const searchParams: any[] = []

  if (search) {
    const asPos = Number(search.replace(/^#/, ''))
    if (Number.isInteger(asPos) && asPos > 0) {
      searchConds.push('(name LIKE ? COLLATE NOCASE OR position = ?)')
      searchParams.push(`%${search}%`, asPos)
    } else {
      searchConds.push('(name LIKE ? COLLATE NOCASE)')
      searchParams.push(`%${search}%`)
    }
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
    filterConds.push(`placement_source = ?`)
    filterParams.push(source)
  }

  if (skillsets.length) {
    filterConds.push(`main_skillset IN (${skillsets.map(() => '?').join(',')})`)
    filterParams.push(...skillsets)
  }

  if (altVersions === 'hide') filterConds.push(`COALESCE(same_as_above, 0) = 0`)
  else if (altVersions === 'only') filterConds.push(`COALESCE(same_as_above, 0) = 1`)

  if (verifyFrom) { filterConds.push(`verify_date >= ?`); filterParams.push(verifyFrom) }
  if (verifyTo)   { filterConds.push(`verify_date <= ?`); filterParams.push(verifyTo) }

  if (ratings.length) {
    const includesUnrated = ratings.includes('Unrated')
    const includesChallenge = ratings.includes('Challenge')
    const tieredChosen = ratings.filter((r) => TIERED_RATING_LEVEL[r] != null)
    const minLevel = tieredChosen.length
      ? Math.min(...tieredChosen.map((r) => TIERED_RATING_LEVEL[r]!))
      : null
    const expanded = minLevel != null
      ? TIERED_RATING_NAMES.filter((r) => TIERED_RATING_LEVEL[r]! >= minLevel)
      : []

    const parts: string[] = []
    if (expanded.length) {
      // Source-flagged levels are reclassified as Challenge above, so exclude
      // them from their old tiered bucket here.
      parts.push(`(rated IN (${expanded.map(() => '?').join(',')}) AND NOT ${IS_CHALLENGE_SQL})`)
      filterParams.push(...expanded)
    }
    if (includesUnrated) parts.push(`((rated IS NULL OR rated = '' OR rated = 'Unrated') AND NOT ${IS_CHALLENGE_SQL})`)
    if (includesChallenge) parts.push(`${IS_CHALLENGE_SQL}`)
    filterConds.push(`(${parts.join(' OR ')})`)
  }

  if (Number.isFinite(enjoyMin)) { filterConds.push(`enjoyment >= ?`); filterParams.push(enjoyMin) }
  if (Number.isFinite(enjoyMax)) { filterConds.push(`enjoyment <= ?`); filterParams.push(enjoyMax) }

  const challengeOnly = ratings.length === 1 && ratings[0] === 'Challenge'
  // Challenge-only mode has always ranked by filter ordering — keep that
  // implicit so the existing "challenge ranks" UX still works without the
  // explicit toggle.
  const useFilterRank = rankByFilter || challengeOnly

  const orderBySort = SORT_SQL[sort]!
  const orderBy = search
    ? `(name = ? COLLATE NOCASE) DESC, ${orderBySort}`
    : orderBySort
  const orderParams = search ? [search] : []

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

  let items: any[]
  if (useFilterRank) {
    // Rank within the filter-only set, then narrow to the search hit list.
    // ROW_NUMBER over the user-selected sort is the displayRank (1-based,
    // independent of pagination offsets).
    const innerSearchClause = searchConds.length ? `WHERE ${searchConds.join(' AND ')}` : ''
    const sql = `
      WITH ranked AS (
        SELECT position, name, difficulty, points, gddl_tier,
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
      `SELECT position, name, difficulty, points, gddl_tier
       FROM ${fromClause} ${allWhere}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    ).all(...allParams, ...orderParams, pageSize, offset) as any[]
  }

  return { total, page, pageSize, items, challengeMode: challengeOnly, rankByFilter: useFilterRank }
})

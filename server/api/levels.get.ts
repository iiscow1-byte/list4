import { getDb } from '~/server/db'

const TIER_ORD_SQL = `
  CASE
    WHEN gddl_tier LIKE 'Subtier %' THEN CAST(SUBSTR(gddl_tier, 9) AS INTEGER)
    WHEN gddl_tier LIKE 'Tier %'    THEN 5 + CAST(SUBSTR(gddl_tier, 6) AS INTEGER)
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
}

const KNOWN_TAG_SUFFIXES = new Set(['old', 'uldm', 'buffed', 'nerfed'])
const KNOWN_RATINGS = new Set(['Challenge', 'Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'])

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
  const creator = typeof q.creator === 'string' ? q.creator.trim() : ''
  const verifyFrom = typeof q.verifyFrom === 'string' ? q.verifyFrom.trim() : ''
  const verifyTo = typeof q.verifyTo === 'string' ? q.verifyTo.trim() : ''
  const ratings = asArray(q.ratings).filter((s) => KNOWN_RATINGS.has(s))
  const enjoyMin = q.enjoyMin != null && q.enjoyMin !== '' ? Number(q.enjoyMin) : null
  const enjoyMax = q.enjoyMax != null && q.enjoyMax !== '' ? Number(q.enjoyMax) : null
  const sort = typeof q.sort === 'string' && SORT_SQL[q.sort] ? q.sort : 'position'

  const db = getDb()
  const conds: string[] = []
  const params: any[] = []

  if (search) {
    const asPos = Number(search.replace(/^#/, ''))
    if (Number.isInteger(asPos) && asPos > 0) {
      conds.push('(name LIKE ? COLLATE NOCASE OR position = ?)')
      params.push(`%${search}%`, asPos)
    } else {
      conds.push('(name LIKE ? COLLATE NOCASE)')
      params.push(`%${search}%`)
    }
  }

  if (Number.isFinite(tierMin)) { conds.push(`(${TIER_ORD_SQL}) >= ?`); params.push(tierMin) }
  if (Number.isFinite(tierMax)) { conds.push(`(${TIER_ORD_SQL}) <= ?`); params.push(tierMax) }

  for (const tag of tags) {
    const label = tag === 'uldm' ? 'ULDM' : tag.charAt(0).toUpperCase() + tag.slice(1)
    conds.push(`name LIKE ? COLLATE NOCASE`)
    params.push(`%(${label})%`)
  }

  if (creator) {
    conds.push(`creator LIKE ? COLLATE NOCASE`)
    params.push(`%${creator}%`)
  }

  if (verifyFrom) { conds.push(`verify_date >= ?`); params.push(verifyFrom) }
  if (verifyTo)   { conds.push(`verify_date <= ?`); params.push(verifyTo) }

  if (ratings.length) {
    const includesUnrated = ratings.includes('Unrated')
    const named = ratings.filter((r) => r !== 'Unrated')
    const parts: string[] = []
    if (named.length) {
      parts.push(`rated IN (${named.map(() => '?').join(',')})`)
      params.push(...named)
    }
    if (includesUnrated) parts.push(`(rated IS NULL OR rated = '' OR rated = 'Unrated')`)
    conds.push(`(${parts.join(' OR ')})`)
  }

  if (Number.isFinite(enjoyMin)) { conds.push(`enjoyment >= ?`); params.push(enjoyMin) }
  if (Number.isFinite(enjoyMax)) { conds.push(`enjoyment <= ?`); params.push(enjoyMax) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const orderBy = SORT_SQL[sort]!

  const total = (db.prepare(`SELECT COUNT(*) as n FROM levels ${where}`).get(...params) as { n: number }).n
  const rows = db
    .prepare(
      `SELECT position, name, difficulty, points, gddl_tier
       FROM levels ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as any[]

  // When the only rating filter is "Challenge", number the rows by their global
  // rank in the filtered ordering (offset + 1, offset + 2, ...) instead of by
  // their natural list position. The hardest challenge becomes #1, etc.
  const challengeOnly = ratings.length === 1 && ratings[0] === 'Challenge'
  const items = challengeOnly
    ? rows.map((r, i) => ({ ...r, displayRank: offset + i + 1 }))
    : rows

  return { total, page, pageSize, items, challengeMode: challengeOnly }
})

import { getDb } from '~/server/db'

const TIER_ORD_SQL = `
  CASE
    WHEN gddl_tier LIKE 'Subtier %' THEN CAST(SUBSTR(gddl_tier, 9) AS INTEGER)
    WHEN gddl_tier LIKE 'Tier %'    THEN 5 + CAST(SUBSTR(gddl_tier, 6) AS INTEGER)
  END
`

const SORT_SQL: Record<string, string> = {
  approved_desc:   'approved_at DESC, id DESC',
  approved_asc:    'approved_at ASC, id ASC',
  name_asc:        'name COLLATE NOCASE ASC',
  verify_desc:     "COALESCE(verify_date,'') DESC, id DESC",
  verify_asc:      "COALESCE(verify_date,'9999') ASC, id ASC",
  enjoyment_desc:  'enjoyment DESC NULLS LAST, id DESC',
  enjoyment_asc:   'enjoyment ASC NULLS LAST, id ASC',
  tier_desc:       `(${TIER_ORD_SQL}) DESC NULLS LAST, id DESC`,
  tier_asc:        `(${TIER_ORD_SQL}) ASC NULLS LAST, id ASC`,
}

const KNOWN_TAG_SUFFIXES = new Set(['old', 'uldm', 'buffed', 'nerfed'])

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
  const verifier = typeof q.verifier === 'string' ? q.verifier.trim() : ''
  const skillset = typeof q.skillset === 'string' ? q.skillset.trim() : ''
  const verifyFrom = typeof q.verifyFrom === 'string' ? q.verifyFrom.trim() : ''
  const verifyTo = typeof q.verifyTo === 'string' ? q.verifyTo.trim() : ''
  const enjoyMin = q.enjoyMin != null && q.enjoyMin !== '' ? Number(q.enjoyMin) : null
  const enjoyMax = q.enjoyMax != null && q.enjoyMax !== '' ? Number(q.enjoyMax) : null
  const sort = typeof q.sort === 'string' && SORT_SQL[q.sort] ? q.sort : 'approved_desc'

  const conds: string[] = []
  const params: any[] = []

  if (search) {
    conds.push('(name LIKE ? COLLATE NOCASE)')
    params.push(`%${search}%`)
  }

  if (Number.isFinite(tierMin)) { conds.push(`(${TIER_ORD_SQL}) >= ?`); params.push(tierMin) }
  if (Number.isFinite(tierMax)) { conds.push(`(${TIER_ORD_SQL}) <= ?`); params.push(tierMax) }

  for (const tag of tags) {
    const label = tag === 'uldm' ? 'ULDM' : tag.charAt(0).toUpperCase() + tag.slice(1)
    conds.push(`name LIKE ? COLLATE NOCASE`)
    params.push(`%(${label})%`)
  }

  if (verifier) {
    conds.push(`verifier LIKE ? COLLATE NOCASE`)
    params.push(`%${verifier}%`)
  }
  if (skillset) {
    conds.push(`main_skillset LIKE ? COLLATE NOCASE`)
    params.push(`%${skillset}%`)
  }
  if (verifyFrom) { conds.push(`verify_date >= ?`); params.push(verifyFrom) }
  if (verifyTo)   { conds.push(`verify_date <= ?`); params.push(verifyTo) }
  if (Number.isFinite(enjoyMin)) { conds.push(`enjoyment >= ?`); params.push(enjoyMin) }
  if (Number.isFinite(enjoyMax)) { conds.push(`enjoyment <= ?`); params.push(enjoyMax) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const orderBy = search
    ? `(name = ? COLLATE NOCASE) DESC, ${SORT_SQL[sort]!}`
    : SORT_SQL[sort]!
  const orderParams = search ? [search] : []

  const db = getDb()
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM awaiting_levels ${where}`).get(...params) as { n: number }).n
  const items = db
    .prepare(
      `SELECT id, name, gd_id, gddl_tier, difficulty, main_skillset, approved_at
       FROM awaiting_levels ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, ...orderParams, pageSize, offset)

  return { total, page, pageSize, items }
})

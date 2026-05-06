import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

const ALLOWED_TAGS = new Set(['old', 'uldm', 'buffed', 'nerfed'])
const ALLOWED_DIFFICULTIES = new Set([
  'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
])

function strOrNull(v: unknown, max = 1000): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return s.slice(0, max)
}

export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const body = await readBody<Record<string, unknown>>(event)

  const gdId = body.gd_id != null && body.gd_id !== '' ? Number(body.gd_id) : null
  if (gdId == null || !Number.isInteger(gdId) || gdId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A valid level ID is required.' })
  }

  const fps = strOrNull(body.fps, 32) ?? 'any'
  const gameVersion = strOrNull(body.game_version, 32) ?? 'any'
  const verification = strOrNull(body.verification, 500)
  const verificationUrl = strOrNull(body.verification_url, 500)
  const accountIsAdmin = account.role === 'admin' || account.role === 'owner' || account.role === 'developer'
  if (!verificationUrl && !accountIsAdmin) {
    throw createError({ statusCode: 400, statusMessage: 'A verification video link is required.' })
  }
  const name = strOrNull(body.name, 200)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Level name is required.' })

  const verifier = strOrNull(body.verifier, 100)
  if (!verifier) throw createError({ statusCode: 400, statusMessage: 'Verifier is required.' })

  const verifyDate = strOrNull(body.verify_date, 32)
  if (!verifyDate) throw createError({ statusCode: 400, statusMessage: 'Verification date is required.' })

  let gddlTier = strOrNull(body.gddl_tier, 32)
  if (gddlTier && !/^(Tier|Subtier) (\d{1,2})$/.test(gddlTier)) {
    throw createError({ statusCode: 400, statusMessage: 'gddl_tier must look like "Tier 5" or "Subtier 3".' })
  }

  let difficulty = strOrNull(body.difficulty, 32)
  if (difficulty && !ALLOWED_DIFFICULTIES.has(difficulty)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown difficulty.' })
  }

  const ABOVE_EASY_DEMON = new Set(['Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon'])
  const ALLOWED_RATINGS = new Set(['Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'])
  const isChallenge = body.is_challenge === true || body.is_challenge === 1 || body.is_challenge === '1'
  const ratingRaw = strOrNull(body.rating, 32)
  const ratingOpinion = ratingRaw && ALLOWED_RATINGS.has(ratingRaw) ? ratingRaw : null
  const rated = isChallenge && difficulty && ABOVE_EASY_DEMON.has(difficulty) ? 'Challenge' : ratingOpinion

  let enjoyment: number | null = null
  if (body.enjoyment != null && body.enjoyment !== '') {
    const n = Number(body.enjoyment)
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      throw createError({ statusCode: 400, statusMessage: 'Enjoyment must be between 0 and 10.' })
    }
    enjoyment = n
  }

  const skillset = strOrNull(body.main_skillset, 32)

  let tags: string | null = null
  if (Array.isArray(body.tags)) {
    const filtered = body.tags
      .map((t) => String(t).toLowerCase())
      .filter((t) => ALLOWED_TAGS.has(t))
    tags = filtered.length ? Array.from(new Set(filtered)).join(',') : null
  }

  const notes = strOrNull(body.notes, 4000)
  // "None" / unset → site-default placement source. Anything else is whatever
  // the submitter said in the dropdown ("Demon List", "Pemonlist", etc.).
  const placementSource = strOrNull(body.placement_source, 100) ?? 'All Levels List'

  let placementEstimate: number | null = null
  if (body.placement_estimate != null && body.placement_estimate !== '') {
    const n = Number(body.placement_estimate)
    if (!Number.isInteger(n) || n <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Placement estimate must be a positive integer.' })
    }
    placementEstimate = n
  }
  let comparisonLevelId: number | null = null
  if (body.comparison_level_id != null && body.comparison_level_id !== '') {
    const n = Number(body.comparison_level_id)
    if (Number.isInteger(n) && n > 0) comparisonLevelId = n
  }
  const comparisonLevelName = strOrNull(body.comparison_level_name, 200)
  const sameAsAbove = body.same_as_above === true || body.same_as_above === 1 || body.same_as_above === '1' ? 1 : 0
  const isAlternate = body.is_alternate === true || body.is_alternate === 1 || body.is_alternate === '1' ? 1 : 0

  function optLevelId(v: unknown): number | null {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : null
  }
  const duplicateOfId = optLevelId(body.duplicate_of_id)
  const alternateOfId = optLevelId(body.alternate_of_id)

  const db = getDb()

  // Reject duplicates already in the main list — only accept gd_ids the list
  // doesn't know about yet (the main use case is "this level should be added").
  const existing = db.prepare(`SELECT position FROM levels WHERE gd_id = ?`).get(gdId) as { position: number } | undefined
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `Level ID ${gdId} is already on the list at #${existing.position}.` })
  }

  // Reject duplicate pending submissions from the same gd_id.
  const dupePending = db
    .prepare(`SELECT id FROM pending_levels WHERE gd_id = ? AND status = 'pending'`)
    .get(gdId) as { id: number } | undefined
  if (dupePending) {
    throw createError({ statusCode: 409, statusMessage: `A submission for level ID ${gdId} is already pending.` })
  }

  const result = db
    .prepare(
      `INSERT INTO pending_levels
        (gd_id, name, fps, game_version, verification, verification_url, verifier, verify_date,
         gddl_tier, difficulty, enjoyment, main_skillset, tags, notes, submitted_by,
         placement_estimate, comparison_level_id, comparison_level_name,
         placement_source, same_as_above, duplicate_of_id, is_alternate, alternate_of_id, rated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      gdId, name, fps, gameVersion, verification, verificationUrl, verifier, verifyDate,
      gddlTier, difficulty, enjoyment, skillset, tags, notes, account.id,
      placementEstimate, comparisonLevelId, comparisonLevelName,
      placementSource, sameAsAbove, duplicateOfId, isAlternate, alternateOfId, rated,
    )

  return { ok: true, id: Number(result.lastInsertRowid) }
})

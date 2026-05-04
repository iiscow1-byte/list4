import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

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

/**
 * Submit a verification claim for an approved open-verification level.
 * Creates a pending_levels row that links back to the open_verifications row
 * via from_open_verification_id. On admin approval, the linked open verification
 * is removed and the level is added to the main list with the supplied
 * verification info.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }

  const body = await readBody<Record<string, unknown>>(event)

  const verifier = strOrNull(body.verifier, 100)
  if (!verifier) {
    throw createError({ statusCode: 400, statusMessage: 'A verifier name is required.' })
  }
  const verificationUrl = strOrNull(body.verification_url, 500)
  if (!verificationUrl) {
    throw createError({ statusCode: 400, statusMessage: 'A verification video link is required.' })
  }
  const verificationTitle = strOrNull(body.verification_title, 500)
  const verifyDate = strOrNull(body.verify_date, 32)
  const notes = strOrNull(body.notes, 4000)

  // Field overrides — allow the form to adjust values inherited from the open-verif row.
  const fpsOverride = strOrNull(body.fps_override, 32)
  const gameVersionOverride = strOrNull(body.game_version_override, 32)
  const mainSkillsetOverride = strOrNull(body.main_skillset_override, 100)
  const tagsOverride = strOrNull(body.tags_override, 500)

  let placementEstimate: number | null = null
  if (body.placement_estimate != null && body.placement_estimate !== '') {
    const n = Number(body.placement_estimate)
    if (Number.isInteger(n) && n > 0) placementEstimate = n
  }

  // Optional opinion-style overrides — same semantics as the record submit.
  let opinionTier = strOrNull(body.opinion_gddl_tier, 32)
  if (opinionTier && !/^(Tier|Subtier) (\d{1,2})$/.test(opinionTier)) {
    throw createError({ statusCode: 400, statusMessage: 'opinion_gddl_tier must look like "Tier 5" or "Subtier 3".' })
  }
  let opinionDifficulty = strOrNull(body.opinion_difficulty, 32)
  if (opinionDifficulty && !ALLOWED_DIFFICULTIES.has(opinionDifficulty)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown difficulty.' })
  }
  let opinionEnjoyment: number | null = null
  if (body.opinion_enjoyment != null && body.opinion_enjoyment !== '') {
    const n = Number(body.opinion_enjoyment)
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      throw createError({ statusCode: 400, statusMessage: 'Enjoyment must be between 0 and 10.' })
    }
    opinionEnjoyment = n
  }

  const db = getDb()

  const ov = db
    .prepare(
      `SELECT id, gd_id, name, fps, game_version, gddl_tier, difficulty, enjoyment,
              main_skillset, tags, notes, placement_source, status
         FROM open_verifications WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number
        gd_id: number | null
        name: string
        fps: string | null
        game_version: string | null
        gddl_tier: string | null
        difficulty: string | null
        enjoyment: number | null
        main_skillset: string | null
        tags: string | null
        notes: string | null
        placement_source: string | null
        status: string
      }
    | undefined
  if (!ov) throw createError({ statusCode: 404, statusMessage: 'Open verification not found.' })
  if (ov.status !== 'approved') {
    throw createError({ statusCode: 409, statusMessage: 'Open verification is not approved.' })
  }

  // Belt-and-suspenders: shouldn't happen because open-verif submit blocks it,
  // but make sure the gd_id isn't already on the main list.
  if (ov.gd_id != null) {
    const onMain = db
      .prepare(`SELECT position FROM levels WHERE gd_id = ?`)
      .get(ov.gd_id) as { position: number } | undefined
    if (onMain) {
      throw createError({
        statusCode: 409,
        statusMessage: `Level ID ${ov.gd_id} is already on the main list at #${onMain.position}.`,
      })
    }
  }

  // Reject if there's already a pending verification submission for this open
  // verification — one in-flight at a time.
  const dupe = db
    .prepare(
      `SELECT id FROM pending_levels
        WHERE from_open_verification_id = ? AND status = 'pending'`,
    )
    .get(id) as { id: number } | undefined
  if (dupe) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A verification submission for this level is already pending review.',
    })
  }

  // Use the submitter's overrides if provided; otherwise inherit from the
  // open-verif's metadata.
  const gddlTier = opinionTier ?? ov.gddl_tier
  const difficulty = opinionDifficulty ?? ov.difficulty
  const enjoyment = opinionEnjoyment ?? ov.enjoyment

  const result = db
    .prepare(
      `INSERT INTO pending_levels
        (gd_id, name, fps, game_version, verification, verification_url, verifier, verify_date,
         gddl_tier, difficulty, enjoyment, main_skillset, tags, notes, submitted_by,
         placement_source, from_open_verification_id, placement_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ov.gd_id,
      ov.name,
      fpsOverride ?? ov.fps,
      gameVersionOverride ?? ov.game_version,
      verificationTitle,
      verificationUrl,
      verifier,
      verifyDate,
      gddlTier,
      difficulty,
      enjoyment,
      mainSkillsetOverride ?? ov.main_skillset,
      tagsOverride ?? ov.tags,
      notes ?? ov.notes,
      account.id,
      ov.placement_source ?? 'All Levels List',
      id,
      placementEstimate,
    )

  return { ok: true, id: Number(result.lastInsertRowid) }
})

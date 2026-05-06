import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { ALLOWED_DIFFICULTIES, TIER_RE } from '~/server/utils/opinions'

/**
 * Submit a void level to the pending list by providing a tier and difficulty
 * opinion. On admin approval the void level is automatically removed.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid position' })
  }

  const body = await readBody<Record<string, unknown>>(event)

  const gddlTier = body?.gddl_tier ? String(body.gddl_tier).trim() : ''
  if (!gddlTier || !TIER_RE.test(gddlTier)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid GDDL tier is required (e.g. "Tier 15" or "Subtier 3").' })
  }
  const difficulty = body?.difficulty ? String(body.difficulty).trim() : ''
  if (!difficulty || !ALLOWED_DIFFICULTIES.has(difficulty)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid difficulty is required.' })
  }

  const verifier = body?.verifier ? String(body.verifier).trim().slice(0, 100) || null : null
  const verificationUrl = body?.verification_url ? String(body.verification_url).trim().slice(0, 500) || null : null
  if (verificationUrl && !/^https?:\/\/\S+$/i.test(verificationUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'Verification URL must be a valid http(s) link.' })
  }
  const verifyDate = body?.verify_date ? String(body.verify_date).trim().slice(0, 32) || null : null
  const notes = body?.notes ? String(body.notes).trim().slice(0, 4000) || null : null

  let enjoyment: number | null = null
  if (body?.enjoyment != null && body.enjoyment !== '') {
    const n = Number(body.enjoyment)
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      throw createError({ statusCode: 400, statusMessage: 'Enjoyment must be 0–10.' })
    }
    enjoyment = n
  }

  const db = getDb()
  const voidLevel = db
    .prepare(`SELECT id, gd_id, name, verification, verification_url, placement_source FROM void_levels WHERE position = ?`)
    .get(position) as { id: number; gd_id: number | null; name: string; verification: string | null; verification_url: string | null; placement_source: string | null } | undefined
  if (!voidLevel) {
    throw createError({ statusCode: 404, statusMessage: 'Void level not found.' })
  }

  // Reject if there's already a pending submission for this void level.
  const existing = db
    .prepare(`SELECT id FROM pending_levels WHERE from_void_level_id = ? AND status = 'pending'`)
    .get(voidLevel.id) as { id: number } | undefined
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'A submission for this level is already pending review.' })
  }

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO pending_levels
        (gd_id, name, verification, verification_url, verifier, verify_date,
         gddl_tier, difficulty, enjoyment, notes, submitted_by, placement_source, from_void_level_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      voidLevel.gd_id,
      voidLevel.name,
      verificationUrl ?? voidLevel.verification,
      verificationUrl ?? voidLevel.verification_url,
      verifier,
      verifyDate,
      gddlTier,
      difficulty,
      enjoyment,
      notes,
      account.id,
      voidLevel.placement_source ?? 'All Levels List',
      voidLevel.id,
    )
    db.prepare(`DELETE FROM void_levels WHERE id = ?`).run(voidLevel.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { ok: true }
})

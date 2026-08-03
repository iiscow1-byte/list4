import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { ALLOWED_DIFFICULTIES, lookupLevel } from '~/server/utils/opinions'
import { isValidTier } from '~/utils/tier-ordinal'

function strOrNull(v: unknown, max = 1000): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return s.slice(0, max)
}

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody<Record<string, unknown>>(event)

  const kind = body.list_kind === 'void' ? 'void' : 'main'
  const position = Number(body.position)
  if (!Number.isFinite(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Pick a level.' })
  }
  const proofUrl = strOrNull(body.proof_url, 500)
  if (!proofUrl || !/^https?:\/\/\S+$/i.test(proofUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid proof of progress URL is required.' })
  }

  const gddlTier = strOrNull(body.gddl_tier, 32)
  if (gddlTier && !isValidTier(gddlTier)) {
    throw createError({ statusCode: 400, statusMessage: 'gddl_tier must look like "Tier 5" or "Subtier 3".' })
  }

  const difficulty = strOrNull(body.difficulty, 32)
  if (difficulty && !ALLOWED_DIFFICULTIES.has(difficulty)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown difficulty.' })
  }

  let enjoyment: number | null = null
  if (body.enjoyment != null && body.enjoyment !== '') {
    const n = Number(body.enjoyment)
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      throw createError({ statusCode: 400, statusMessage: 'Enjoyment must be between 0 and 10.' })
    }
    enjoyment = n
  }

  if (!gddlTier && !difficulty && enjoyment == null) {
    throw createError({ statusCode: 400, statusMessage: 'Provide at least a difficulty/tier or an enjoyment rating.' })
  }

  const notes = strOrNull(body.notes, 4000)
  const requestRelocation = body.request_relocation ? 1 : 0

  let requestedPosition: number | null = null
  if (body.requested_position != null && body.requested_position !== '') {
    const n = Number(body.requested_position)
    if (!Number.isInteger(n) || n <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Requested position must be a positive integer.' })
    }
    requestedPosition = n
  }

  let comparisonLevelId: number | null = null
  if (body.comparison_level_id != null && body.comparison_level_id !== '') {
    const n = Number(body.comparison_level_id)
    if (Number.isInteger(n) && n > 0) comparisonLevelId = n
  }
  const comparisonLevelName = strOrNull(body.comparison_level_name, 200)

  const db = getDb()
  const level = lookupLevel(db, kind, position)
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  // One pending opinion per (account, level) — second submissions replace the first.
  db.prepare(
    `DELETE FROM opinions
      WHERE list_kind = ? AND level_id = ? AND submitted_by = ? AND status = 'pending'`,
  ).run(kind, level.id, me.id)

  const result = db
    .prepare(
      `INSERT INTO opinions
        (list_kind, level_id, submitted_by, proof_url, gddl_tier, difficulty, enjoyment,
         notes, request_relocation, requested_position, comparison_level_id, comparison_level_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      kind, level.id, me.id, proofUrl, gddlTier, difficulty, enjoyment,
      notes, requestRelocation, requestedPosition, comparisonLevelId, comparisonLevelName,
    )

  return { ok: true, id: Number(result.lastInsertRowid) }
})

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { isValidTier } from '~/utils/tier-ordinal'

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

  const name = strOrNull(body.name, 200)
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'A level name is required.' })
  }

  const fps = strOrNull(body.fps, 32) ?? 'any'
  const gameVersion = strOrNull(body.game_version, 32) ?? 'any'
  const showcaseUrl = strOrNull(body.showcase_url, 500)
  const verifier = strOrNull(body.verifier, 100)

  let gddlTier = strOrNull(body.gddl_tier, 32)
  if (gddlTier && !isValidTier(gddlTier)) {
    throw createError({ statusCode: 400, statusMessage: 'gddl_tier must look like "Tier 5" or "Subtier 3".' })
  }

  let difficulty = strOrNull(body.difficulty, 32)
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

  const skillset = strOrNull(body.main_skillset, 32)

  let tags: string | null = null
  if (Array.isArray(body.tags)) {
    const filtered = body.tags
      .map((t) => String(t).toLowerCase())
      .filter((t) => ALLOWED_TAGS.has(t))
    tags = filtered.length ? Array.from(new Set(filtered)).join(',') : null
  }

  const notes = strOrNull(body.notes, 4000)
  const placementSource = strOrNull(body.placement_source, 100) ?? 'All Levels List'

  const db = getDb()

  // Reject if a verified copy already exists on the main list with this gd_id.
  const existingMain = db.prepare(`SELECT position FROM levels WHERE gd_id = ?`).get(gdId) as { position: number } | undefined
  if (existingMain) {
    throw createError({ statusCode: 409, statusMessage: `Level ID ${gdId} is already on the main list at #${existingMain.position}.` })
  }
  // Reject if there's already a pending or approved open-verification for this gd_id.
  const existingOpen = db.prepare(
    `SELECT id, status FROM open_verifications WHERE gd_id = ? AND status IN ('pending','approved')`,
  ).get(gdId) as { id: number; status: string } | undefined
  if (existingOpen) {
    throw createError({
      statusCode: 409,
      statusMessage: `An open-verification submission for level ID ${gdId} already exists (${existingOpen.status}).`,
    })
  }

  const result = db
    .prepare(
      `INSERT INTO open_verifications
        (gd_id, name, fps, game_version, showcase_url, verifier,
         gddl_tier, difficulty, enjoyment, main_skillset, tags, notes,
         placement_source, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      gdId, name, fps, gameVersion, showcaseUrl, verifier,
      gddlTier, difficulty, enjoyment, skillset, tags, notes,
      placementSource, account.id,
    )

  return { ok: true, id: Number(result.lastInsertRowid) }
})

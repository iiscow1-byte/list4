import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { ALLOWED_DIFFICULTIES, TIER_RE } from '~/server/utils/opinions'

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody(event)

  const position = Number(body?.position)
  const holder = String(body?.player_name ?? '').trim()
  const video = String(body?.video ?? '').trim()
  const noteRaw = body?.note == null ? null : String(body.note).trim()
  const note = noteRaw ? noteRaw.slice(0, 2000) : null
  const isVerificationClaim = body?.is_verification_claim ? 1 : 0

  if (!Number.isFinite(position)) {
    throw createError({ statusCode: 400, statusMessage: 'Pick a level.' })
  }
  if (!holder) {
    throw createError({ statusCode: 400, statusMessage: 'Record holder is required.' })
  }
  if (!/^https?:\/\/\S+$/i.test(video)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid video URL is required.' })
  }

  // Optional opinion fields piggy-backed on the record submission.
  const optTier = body?.opinion_gddl_tier ? String(body.opinion_gddl_tier).trim() : null
  if (optTier && !TIER_RE.test(optTier)) {
    throw createError({ statusCode: 400, statusMessage: 'opinion_gddl_tier must look like "Tier 5" or "Subtier 3".' })
  }
  const optDifficulty = body?.opinion_difficulty ? String(body.opinion_difficulty).trim() : null
  if (optDifficulty && !ALLOWED_DIFFICULTIES.has(optDifficulty)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown opinion difficulty.' })
  }
  let optEnjoy: number | null = null
  if (body?.opinion_enjoyment != null && body.opinion_enjoyment !== '') {
    const n = Number(body.opinion_enjoyment)
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      throw createError({ statusCode: 400, statusMessage: 'Opinion enjoyment must be 0–10.' })
    }
    optEnjoy = n
  }

  const db = getDb()
  const level = db.prepare(`SELECT id, verifier FROM levels WHERE position = ?`).get(position) as { id: number; verifier: string | null } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  // Reject duplicate submissions for the same player on the same level.
  const existing = db.prepare(
    `SELECT id, permanent FROM records WHERE level_id = ? AND player_name = ? COLLATE NOCASE LIMIT 1`,
  ).get(level.id, holder) as { id: number; permanent: number } | undefined
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: existing.permanent
        ? 'A record for this player already exists on this level.'
        : 'A record for this player is already pending review for this level.',
    })
  }

  // Silently ignore the claim if the level already has a verifier — the UI hides
  // the checkbox in this case, but enforce on the server too.
  const verificationClaim = isVerificationClaim && !level.verifier ? 1 : 0

  // Resolve to a leaderboard player if we can; not required — record holders
  // may not be on the leaderboard yet, and the players table can be wiped on
  // re-import anyway, so the canonical reference is the denormalized name.
  const player = db.prepare(`SELECT id FROM players WHERE name = ? COLLATE NOCASE`).get(holder) as { id: number } | undefined

  const recResult = db.prepare(
    `INSERT INTO records (level_id, player_id, player_name, video, submitted_by, submitter_note, is_verification_claim)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(level.id, player?.id ?? null, holder, video, me.id, note, verificationClaim)

  // Linked opinion travels with the record — approved together when the
  // record is approved, rejected together when it is rejected.
  if (optTier || optDifficulty || optEnjoy != null) {
    const recId = Number(recResult.lastInsertRowid)
    db.prepare(
      `INSERT INTO opinions
        (list_kind, level_id, submitted_by, proof_url, gddl_tier, difficulty, enjoyment, source_record_id)
       VALUES ('main', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(level.id, me.id, video, optTier, optDifficulty, optEnjoy, recId)
  }

  return { ok: true }
})

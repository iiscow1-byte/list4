import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { recordPlacement } from '~/server/utils/changes'

/**
 * Promote an Aredl-only level (one whose gd_id isn't yet on the ALL list)
 * into the main `levels` table. Admin-only. Requires a placement (1-based
 * position) — the caller picks where the level lands. Existing rows at or
 * after that position shift down by one.
 *
 * On success, the aredl_levels row is kept around with `promoted_to_position`
 * set so a subsequent re-import knows it has already been promoted (and the
 * merge step will then update the ALL row's aredl_position / aredl_tags /
 * edel_enjoyment instead of re-inserting it as Aredl-only).
 */
export default defineEventHandler(async (event) => {
  const account = requireAdmin(event)
  const uuid = String(getRouterParam(event, 'uuid') ?? '').trim()
  if (!uuid) throw createError({ statusCode: 400, statusMessage: 'uuid required' })

  const body = await readBody<{ placement: number }>(event)
  const placement = Number(body?.placement)
  if (!Number.isInteger(placement) || placement <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A valid placement (1-based position) is required.' })
  }

  const db = getDb()
  const src = db.prepare(`SELECT * FROM aredl_levels WHERE uuid = ?`).get(uuid) as any
  if (!src) throw createError({ statusCode: 404, statusMessage: 'Aredl level not found.' })

  // Defensive: an existing ALL row with the same gd_id means a previous
  // import already merged this level — promotion would create a duplicate.
  const dup = db.prepare(`SELECT id, position FROM levels WHERE gd_id = ?`).get(src.gd_id) as { id: number; position: number } | undefined
  if (dup) {
    throw createError({
      statusCode: 409,
      statusMessage: `gd_id ${src.gd_id} is already on the ALL list at position ${dup.position}.`,
    })
  }

  let insertedId: number
  let actualPlacement: number
  db.exec('BEGIN')
  try {
    const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
    actualPlacement = Math.min(placement, maxPos + 1)
    db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ?`).run(actualPlacement)
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()

    // Pull the verification URL from the Aredl record (recorded at import
    // time as the first verification's video_url) and use it as our verif URL.
    const verUrl = src.verification_url ?? null
    const verifyYear = null // Aredl doesn't expose a verification date

    const result = db.prepare(
      `INSERT INTO levels
        (position, name, gd_id, gddl_tier, category, source_tab, creator, verifier,
         publisher, permanent, enjoyment, edel_enjoyment, pov_placement,
         placement_source, verification_url, year_verified,
         aredl_position, aredl_tags)
       VALUES (?, ?, ?, ?, 'classic', 'AREDL', ?, ?, ?, 1, NULL, ?, ?, 'AREDL', ?, ?, ?, ?)`,
    ).run(
      actualPlacement,
      src.name,
      src.gd_id,
      src.gddl_tier ?? null,
      src.creators_json ? safeCreatorString(src.creators_json) : null,
      src.verifier_name ?? null,
      src.publisher_name ?? null,
      src.edel_enjoyment ?? null,
      actualPlacement,
      verUrl,
      verifyYear,
      src.position,
      src.tags ?? null,
    )
    insertedId = Number(result.lastInsertRowid)
    recordPlacement(db, insertedId, actualPlacement, account.id)

    db.prepare(`UPDATE aredl_levels SET promoted_to_position = ? WHERE uuid = ?`).run(actualPlacement, uuid)

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  recomputePoints(db)
  return { ok: true, placement: actualPlacement, level_id: insertedId }
})

function safeCreatorString(json: string): string | null {
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return null
    const names = arr.filter((s): s is string => typeof s === 'string' && s.length > 0)
    return names.length ? names.join(' & ') : null
  } catch {
    return null
  }
}

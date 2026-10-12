import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { afterListChange, insertLevelAt, tx } from '~/server/utils/list-ops'

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

  const placed = tx(db, () => {
    const res = insertLevelAt(db, placement, {
      name: src.name,
      gd_id: src.gd_id,
      gddl_tier: src.gddl_tier ?? null,
      source_tab: 'AREDL',
      creator: src.creators_json ? safeCreatorString(src.creators_json) : null,
      verifier: src.verifier_name ?? null,
      publisher: src.publisher_name ?? null,
      edel_enjoyment: src.edel_enjoyment ?? null,
      placement_source: 'AREDL',
      verification_url: src.verification_url ?? null,
      aredl_position: src.position,
      aredl_tags: src.tags ?? null,
    }, account.id)
    db.prepare(`UPDATE levels SET pov_placement = ? WHERE id = ?`).run(res.position, res.id)
    db.prepare(`UPDATE aredl_levels SET promoted_to_position = ? WHERE uuid = ?`).run(res.position, uuid)
    return res
  })
  afterListChange(db)

  return { ok: true, placement: placed.position, level_id: placed.id }
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

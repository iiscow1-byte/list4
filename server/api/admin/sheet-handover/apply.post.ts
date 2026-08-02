import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { handoverCandidates, handOverToSheet, type HandoverResult } from '~/server/utils/sheet-handover'

/**
 * Hand levels back to the sheet.
 *
 * `level_id` for one, `level_ids` for several, or `matched: true` for every
 * site-owned level the sheet already has a row for — which is the one-click
 * case, and the only bulk form offered. There is deliberately no "all": a level
 * with no sheet row behind it would have its ownership dropped for nothing.
 */
const MAX_BATCH = 500

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<{ level_id?: number; level_ids?: number[]; matched?: boolean }>(event) ?? {}
  const db = getDb()

  let ids: number[]
  if (body.matched) {
    ids = handoverCandidates(db).filter((c) => c.sheet).map((c) => c.level_id)
  } else {
    ids = (Array.isArray(body.level_ids) ? body.level_ids : [body.level_id])
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0)
  }
  ids = ids.slice(0, MAX_BATCH)
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'No levels to hand over.' })

  const results: HandoverResult[] = ids.map((id) => handOverToSheet(db, id))
  const handed = results.filter((r) => r.handed_over).length

  // Tier and difficulty can both change when the sheet's data lands, and points
  // are derived from tier + position.
  if (handed) recomputePoints(db)

  return { ok: true, handed_over: handed, skipped: results.length - handed, results }
})

import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { moveLevel } from '~/server/utils/move-level'
import { computeImportedMovements, invalidateImportedMovementSummary } from '~/server/utils/imported-movements'

/**
 * Move levels to where an imported list says they belong.
 *
 * Targets are re-derived here rather than taken from the request: the client's
 * numbers were computed when the tab loaded, and each move shifts everything it
 * passes, so applying a list of stale targets in sequence would put the second
 * one in the wrong place. Every level is looked up again against the current
 * list immediately before it moves.
 */
const MAX_BATCH = 50

export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const body = await readBody<{ source?: string; level_ids?: number[]; level_id?: number }>(event) ?? {}
  const source = String(body.source ?? '').trim()
  if (!source) throw createError({ statusCode: 400, statusMessage: 'Which list?' })

  const ids = (Array.isArray(body.level_ids) ? body.level_ids : [body.level_id])
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0)
    .slice(0, MAX_BATCH)
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'No levels to move.' })

  const db = getDb()
  const results: Array<{
    level_id: number; name: string; from: number; to: number; moved: boolean
    tier_from?: string | null; tier_to?: string | null; reason?: string
  }> = []
  let moved = 0

  for (const id of ids) {
    // Recomputed per level: the previous move renumbered part of the list.
    const { items } = computeImportedMovements(db, source)
    const row = items.find((i) => i.level_id === id)
    if (!row) {
      const name = (db.prepare(`SELECT name FROM levels WHERE id = ?`).get(id) as { name: string } | undefined)?.name
      results.push({
        level_id: id, name: name ?? `#${id}`, from: 0, to: 0, moved: false,
        reason: 'No longer disagrees with that list.',
      })
      continue
    }
    try {
      const res = moveLevel(db, row.from_position, row.to_position, account.id)
      results.push({
        level_id: id, name: row.name, from: res.from, to: res.to, moved: res.moved,
        tier_from: res.tier_from ?? null, tier_to: res.tier_to ?? null,
      })
      if (res.moved) moved++
    } catch (e: any) {
      results.push({
        level_id: id, name: row.name, from: row.from_position, to: row.to_position,
        moved: false, reason: e?.message ?? 'Move failed.',
      })
    }
  }

  // Tier midpoints shift when levels cross tier boundaries; one recompute for
  // the whole batch rather than one per move.
  if (moved) {
    recomputePoints(db)
    invalidateImportedMovementSummary()
  }

  return { ok: true, moved, results }
})

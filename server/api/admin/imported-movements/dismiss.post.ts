import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { invalidateImportedMovementSummary } from '~/server/utils/imported-movements'

/**
 * "We disagree with that list here, on purpose."
 *
 * Recorded against the rank the source list currently gives the level, so the
 * suggestion returns if that list changes its mind. `undo: true` removes the
 * dismissal.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const body = await readBody<{
    source?: string; level_id?: number; source_position?: number; undo?: boolean
  }>(event) ?? {}

  const source = String(body.source ?? '').trim()
  const levelId = Number(body.level_id)
  if (!source || !Number.isInteger(levelId) || levelId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A list and a level are required.' })
  }

  const db = getDb()
  if (body.undo) {
    db.prepare(`DELETE FROM imported_movement_dismissals WHERE source = ? AND level_id = ?`)
      .run(source, levelId)
    invalidateImportedMovementSummary()
    return { ok: true, dismissed: false }
  }

  const sourcePosition = Number(body.source_position)
  if (!Number.isInteger(sourcePosition) || sourcePosition <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'That suggestion has no source rank.' })
  }

  db.prepare(
    `INSERT INTO imported_movement_dismissals (source, level_id, source_position, dismissed_by)
     VALUES (?,?,?,?)
     ON CONFLICT(source, level_id) DO UPDATE SET
       source_position = excluded.source_position,
       dismissed_at    = datetime('now'),
       dismissed_by    = excluded.dismissed_by`,
  ).run(source, levelId, sourcePosition, account.id)

  invalidateImportedMovementSummary()
  return { ok: true, dismissed: true }
})

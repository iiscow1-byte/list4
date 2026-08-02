import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, dataDir } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { buildSnapshot, resetToSheetOrder } from '~/server/utils/placement-snapshot'

/**
 * Put every sheet-backed level back into the sheet's own order, without
 * re-downloading the sheet.
 *
 * The site's own levels — the ones the sheet has never carried, which have no
 * sheet number — hold their positions and the sheet-backed rows flow around
 * them, which is exactly what a full sheet import does. `?apply=1` writes;
 * otherwise this reports what it would do.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const apply = String(getQuery(event).apply ?? '') === '1'
  const db = getDb()

  let backup: string | null = null
  if (apply) {
    try {
      const dir = join(dataDir(), 'backups')
      mkdirSync(dir, { recursive: true })
      const name = `placements-before-sheet-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      writeFileSync(join(dir, name), JSON.stringify(buildSnapshot(db)))
      backup = name
    } catch (e) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not save the pre-reset snapshot, so nothing was changed: ${(e as Error).message}`,
      })
    }
  }

  const result = resetToSheetOrder(db, { apply })
  if (result.applied) recomputePoints(db)

  return { ok: true, backup, ...result }
})

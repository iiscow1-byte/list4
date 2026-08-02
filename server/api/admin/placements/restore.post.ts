import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, dataDir } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { buildSnapshot, parseSnapshot, restoreSnapshot } from '~/server/utils/placement-snapshot'

/**
 * Put a placement file back onto the list.
 *
 * The body is the file itself — JSON or CSV, sniffed rather than declared — so
 * nothing has to survive being re-encoded inside a JSON envelope on the way
 * here. `?apply=1` writes; without it this is a preview, which is how the admin
 * UI always asks first: reordering the whole list is not a blind button.
 *
 * Before a write, the *current* placements are saved next to the database. A
 * restore is itself the kind of thing you may need to undo.
 */
const MAX_BYTES = 32 * 1024 * 1024

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const apply = String(getQuery(event).apply ?? '') === '1'

  const raw = await readRawBody(event, 'utf8')
  if (!raw || !raw.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'No file was uploaded.' })
  }
  if (raw.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'That file is too large to be a placement snapshot.' })
  }

  let parsed
  try {
    parsed = parseSnapshot(raw)
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message ?? 'Could not read that file.' })
  }
  if (!parsed.entries.length) {
    throw createError({ statusCode: 400, statusMessage: 'That file lists no levels.' })
  }

  const db = getDb()

  let backup: string | null = null
  if (apply) {
    try {
      const dir = join(dataDir(), 'backups')
      mkdirSync(dir, { recursive: true })
      const name = `placements-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      writeFileSync(join(dir, name), JSON.stringify(buildSnapshot(db)))
      backup = name
    } catch (e) {
      // A restore that can't write its own safety net is one worth stopping.
      throw createError({
        statusCode: 500,
        statusMessage: `Could not save the pre-restore snapshot, so nothing was changed: ${(e as Error).message}`,
      })
    }
  }

  const result = restoreSnapshot(db, parsed.entries, { apply })

  // Points are derived from tier + position, so a reorder invalidates them.
  if (result.applied) recomputePoints(db)

  return { ok: true, read: parsed.kind, generated_at: parsed.generated_at, backup, ...result }
})

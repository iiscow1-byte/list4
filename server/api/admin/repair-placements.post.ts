import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { afterListChange, syncDisplayNumbers } from '~/server/utils/list-ops'

/**
 * Make every printed number match the level's place in the list again, and
 * recompute points. Safe at any time; on a healthy list it changes nothing.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const changed = syncDisplayNumbers(db)
  afterListChange(db)
  return { ok: true, changed }
})

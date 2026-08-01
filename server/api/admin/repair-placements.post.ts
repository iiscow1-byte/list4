import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { countPlacementBreaks, resyncPlacements } from '~/server/utils/placement-sync'

/**
 * Re-attach every placement number to the slot it belongs to.
 *
 * The same repair runs once at boot; this exposes it as a button so a list that
 * drifts can be fixed without a restart. Safe to run at any time — on a healthy
 * list it changes nothing.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()

  const before = countPlacementBreaks(db)
  db.exec('BEGIN')
  let changed = 0
  try {
    changed = resyncPlacements(db)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { ok: true, inversions_before: before, inversions_after: countPlacementBreaks(db), changed }
})

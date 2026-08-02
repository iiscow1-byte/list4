import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { buildSnapshot, snapshotToCsv } from '~/server/utils/placement-snapshot'

/**
 * Download every level's placement as a file.
 *
 * JSON is the faithful record — it carries the level ids, which is what makes a
 * later restore exact. CSV is the editable one: open it, retype some numbers,
 * upload it back. Both restore through the same endpoint.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const format = String(getQuery(event).format ?? 'json').toLowerCase()
  const snap = buildSnapshot(getDb())
  const stamp = snap.generated_at.slice(0, 10)

  if (format === 'csv') {
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="all-placements-${stamp}.csv"`)
    return snapshotToCsv(snap)
  }

  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="all-placements-${stamp}.json"`)
  return snap
})

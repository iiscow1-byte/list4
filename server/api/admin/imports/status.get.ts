import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { getImportRunningSet, getImportQueuedSet, getAllImportProgress } from '~/server/utils/imports-state'
import { GDTPL_LISTS, gdtplPendingWhere } from '~/server/db/gdtpl-lists'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()

  /**
   * Pending rows waiting on a decision, per source.
   *
   * The GDListTemplate lists are counted from the same registry the runner and
   * the pending-clear use, so a list cannot show one list's count under another
   * list's name — every slug appeared in a hand-written subquery here before.
   */
  const countPending = (where: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels WHERE ${where}`).get() as { n: number }).n

  const pendingCounts: Record<string, number> = {
    sheet: countPending(`from_sheet_pending = 1 AND status = 'pending'`),
    gdl:   countPending(`from_gdl_id IS NOT NULL AND status = 'pending'`),
    acs:   countPending(`from_acs_id IS NOT NULL AND status = 'pending'`),
    cl:    countPending(gdtplPendingWhere('cl')),
    ...Object.fromEntries(
      GDTPL_LISTS.map((l) => [l.config.source, countPending(gdtplPendingWhere(l.config.source))]),
    ),
  }

  const running = Array.from(getImportRunningSet())
  const queued = Array.from(getImportQueuedSet())
  return { pendingCounts, running, queued, progress: getAllImportProgress() }
})

import { getDb } from '~/server/db'
import { requireListStaff } from '~/server/utils/auth'
import { importedMovementSummary } from '~/server/utils/imported-movements'
import { openReportCount } from '~/server/utils/reports'

export default defineEventHandler((event) => {
  const account = requireListStaff(event)
  const db = getDb()
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n

  // Computed from the imported lists rather than read from a table, so it is
  // cached — this endpoint is polled every 30 s by every open admin tab. The
  // badge shows the *change* since the tab was last opened (a new tab key is
  // seeded to its current value), which is what makes a standing comparison of
  // thousands of levels a useful notification rather than a permanent alarm.
  const importedMovements = importedMovementSummary(db)
    .reduce((n, s) => n + s.disagreements, 0)

  return {
    'imported-movements': importedMovements,
    records:              count(`SELECT COUNT(*) AS n FROM records               WHERE permanent = 0`),
    opinions:             count(`SELECT COUNT(*) AS n FROM opinions              WHERE status = 'pending'`),
    levels:               count(`SELECT COUNT(*) AS n FROM pending_levels        WHERE status = 'pending' AND from_gdl_id IS NULL`),
    'imported-levels':    count(`SELECT COUNT(*) AS n FROM pending_levels        WHERE status = 'pending' AND from_gdl_id IS NOT NULL`),
    awaiting:             count(`SELECT COUNT(*) AS n FROM awaiting_levels`),
    movements:            count(`SELECT COUNT(*) AS n FROM pending_movements     WHERE status = 'pending'`),
    'open-verifications': count(`SELECT COUNT(*) AS n FROM open_verifications    WHERE status = 'pending'`),
    claims:               count(`SELECT COUNT(*) AS n FROM claim_requests        WHERE status = 'pending'`),
    // Moves and challenge changes list helpers have asked an admin to make.
    'helper-requests':    count(`SELECT COUNT(*) AS n FROM helper_requests       WHERE status = 'pending'`),
    // Open reports the viewer is allowed to see. Deliberately goes through the
    // same visibility rule as the queue: a badge counting reports the page then
    // refuses to show is how somebody learns a report about them exists.
    reports:              openReportCount(db, account),
  }
})

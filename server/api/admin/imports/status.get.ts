import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { getImportRunningSet } from '~/server/utils/imports-state'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()

  const pendingCounts = {
    sheet: (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels WHERE from_sheet_pending = 1 AND status = 'pending'`).get() as { n: number }).n,
    gdl:   (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels WHERE from_gdl_id IS NOT NULL AND status = 'pending'`).get() as { n: number }).n,
    tsl:   (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels p
                        WHERE p.status = 'pending' AND p.from_gdtpl_id IN
                              (SELECT id FROM gdtpl_levels WHERE list_slug = 'tsl')`).get() as { n: number }).n,
    edi:   (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels p
                        WHERE p.status = 'pending' AND p.from_gdtpl_id IN
                              (SELECT id FROM gdtpl_levels WHERE list_slug = 'edi')`).get() as { n: number }).n,
    ccl:   (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels p
                        WHERE p.status = 'pending' AND p.from_gdtpl_id IN
                              (SELECT id FROM gdtpl_levels WHERE list_slug = 'ccl')`).get() as { n: number }).n,
    ll:    (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels p
                        WHERE p.status = 'pending' AND p.from_gdtpl_id IN
                              (SELECT id FROM gdtpl_levels WHERE list_slug = 'll')`).get() as { n: number }).n,
    tcl:   (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels p
                        WHERE p.status = 'pending' AND p.from_gdtpl_id IN
                              (SELECT id FROM gdtpl_levels WHERE list_slug = 'tcl')`).get() as { n: number }).n,
    sfl:   (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels p
                        WHERE p.status = 'pending' AND p.from_gdtpl_id IN
                              (SELECT id FROM gdtpl_levels WHERE list_slug = 'sfl')`).get() as { n: number }).n,
    ddl:   (db.prepare(`SELECT COUNT(*) AS n FROM pending_levels p
                        WHERE p.status = 'pending' AND p.from_gdtpl_id IN
                              (SELECT id FROM gdtpl_levels WHERE list_slug = 'ddl')`).get() as { n: number }).n,
  }

  const running = Array.from(getImportRunningSet())
  return { pendingCounts, running }
})

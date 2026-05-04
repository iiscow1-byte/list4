import { getDb } from '~/server/db'
import { runImport } from '~/server/db/import'
import { importAredl } from '~/server/db/import-aredl'

/**
 * On boot, if the levels table is empty, kick off a background import of the
 * Google Sheet. Keeps server startup instant — first requests will see an empty
 * list until the import (~2 min) completes, after which data appears.
 *
 * Same logic for Aredl: if aredl_players is empty, kick off the Aredl import
 * in the background after the sheet import settles. The Aredl import is
 * heavier (~30 min on a fresh DB), but is fully idempotent on re-runs.
 *
 * Skipped when LIST_SKIP_AUTO_IMPORT=1.
 */
export default defineNitroPlugin(() => {
  if (process.env.LIST_SKIP_AUTO_IMPORT === '1') return
  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM levels').get() as { n: number }
  const sheetWork = n > 0
    ? Promise.resolve()
    : (() => {
        console.log('[db-init] empty database detected — running sheet import in background')
        return runImport()
      })()

  sheetWork
    .catch((err) => console.error('[db-init] background import failed:', err))
    .then(() => {
      const { n: ap } = db.prepare('SELECT COUNT(*) AS n FROM aredl_players').get() as { n: number }
      if (ap > 0) return
      if (process.env.LIST_SKIP_AREDL_IMPORT === '1') return
      console.log('[db-init] aredl_players empty — running Aredl import in background')
      return importAredl().catch((err) => console.error('[db-init] aredl import failed:', err))
    })
})

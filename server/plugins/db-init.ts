import { getDb } from '~/server/db'
import { runImport } from '~/server/db/import'
import { importAredl } from '~/server/db/import-aredl'
import { importPointercrate } from '~/server/db/import-pointercrate'

/**
 * On boot, if the levels table is empty, kick off a background import of the
 * Google Sheet. Keeps server startup instant — first requests will see an empty
 * list until the import (~2 min) completes, after which data appears.
 *
 * Same logic for Aredl/Pointercrate: chained after the sheet import so the
 * external mirrors have ALL-list rows to merge into. Each is idempotent and
 * skipped when its respective LIST_SKIP_*_IMPORT env var is set.
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
    .then(async () => {
      if (process.env.LIST_SKIP_AREDL_IMPORT !== '1') {
        const { n: ap } = db.prepare('SELECT COUNT(*) AS n FROM aredl_players').get() as { n: number }
        if (ap === 0) {
          console.log('[db-init] aredl_players empty — running Aredl import in background')
          await importAredl().catch((err) => console.error('[db-init] aredl import failed:', err))
        }
      }
      if (process.env.LIST_SKIP_POINTERCRATE_IMPORT !== '1') {
        const { n: pp } = db.prepare('SELECT COUNT(*) AS n FROM pointercrate_players').get() as { n: number }
        if (pp === 0) {
          console.log('[db-init] pointercrate_players empty — running Pointercrate import in background')
          await importPointercrate().catch((err) => console.error('[db-init] pointercrate import failed:', err))
        }
      }
    })
})

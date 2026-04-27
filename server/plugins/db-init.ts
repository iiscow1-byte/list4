import { getDb } from '~/server/db'
import { runImport } from '~/server/db/import'

/**
 * On boot, if the levels table is empty, kick off a background import of the
 * Google Sheet. Keeps server startup instant — first requests will see an empty
 * list until the import (~2 min) completes, after which data appears.
 *
 * Skipped when LIST_SKIP_AUTO_IMPORT=1.
 */
export default defineNitroPlugin(() => {
  if (process.env.LIST_SKIP_AUTO_IMPORT === '1') return
  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM levels').get() as { n: number }
  if (n > 0) return

  console.log('[db-init] empty database detected — running sheet import in background')
  runImport().catch((err) => {
    console.error('[db-init] background import failed:', err)
  })
})

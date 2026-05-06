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
        // Always re-run Pointercrate on boot — the importer is idempotent
        // (UPSERT on records/players, legacy demons skipped via
        // pointercrate_legacy_imported), so re-runs cheaply pick up new
        // ranked records without re-fetching legacy demons.
        console.log('[db-init] running Pointercrate import in background (refresh on restart)')
        await importPointercrate().catch((err) => {
          // Cloudflare 403s every datacenter-IP request to pointercrate.com
          // (Railway, Fly, Render, etc.). Log it as a one-line warning rather
          // than a stack trace — the import simply won't run on those hosts
          // until a proxy is set up, but the rest of the app keeps working.
          const msg = (err as Error)?.message ?? String(err)
          if (msg.includes('HTTP 403')) {
            console.warn('[db-init] pointercrate import skipped: Cloudflare 403 (datacenter IP block). Set LIST_SKIP_POINTERCRATE_IMPORT=1 to silence, or run via a proxy.')
          } else {
            console.error('[db-init] pointercrate import failed:', err)
          }
        })
      }
    })
})

import { getDb } from '~/server/db'
import { runImport } from '~/server/db/import'
import { importAredl } from '~/server/db/import-aredl'
import { importPointercrate } from '~/server/db/import-pointercrate'
import { importGsv } from '~/server/db/import-gsv'
import { importTsl } from '~/server/db/import-tsl'
import { importEdi } from '~/server/db/import-edi'

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
        // (UPSERT on players + level metadata), cheap to re-run, and now no
        // longer fetches per-demon records.
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
      if (process.env.LIST_SKIP_GSV_IMPORT !== '1') {
        // GSV is now the canonical source for `aredl_records`. Run it after
        // the AREDL/PC importers so level metadata (used for cross-list
        // dedup at query time) is populated before records land.
        console.log('[db-init] running Global Stats Viewer import in background (refresh on restart)')
        await importGsv().catch((err) => console.error('[db-init] gsv import failed:', err))
      }
      if (process.env.LIST_SKIP_TSL_IMPORT !== '1') {
        // TSL (and any other GDListTemplate-based list) — fast: ~160 small JSON
        // fetches. Idempotent, safe to re-run on every boot. Adding another
        // GDListTemplate-based list later is one more importTsl-style call.
        console.log('[db-init] running TSL import in background (refresh on restart)')
        await importTsl().catch((err) => console.error('[db-init] tsl import failed:', err))
      }
      if (process.env.LIST_SKIP_EDI_IMPORT !== '1') {
        console.log('[db-init] running EDI import in background (refresh on restart)')
        await importEdi().catch((err) => console.error('[db-init] edi import failed:', err))
      }
    })
})

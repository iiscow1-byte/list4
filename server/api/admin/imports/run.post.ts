import { requireAdmin } from '~/server/utils/auth'
import {
  isImportRunning, startImport, finishImport, queueImport, isImportQueued, dequeueImport,
  setImportProgress, type ProgressReporter,
} from '~/server/utils/imports-state'
import { invalidateImportedMovementSummary } from '~/server/utils/imported-movements'
import { importPendingList, runImport } from '~/server/db/import'
import { importGdl } from '~/server/db/import-gdl'
import { importTsl } from '~/server/db/import-tsl'
import { importEdi } from '~/server/db/import-edi'
import { importCcl } from '~/server/db/import-ccl'
import { importDdl } from '~/server/db/import-ddl'
import { importLl } from '~/server/db/import-ll'
import { importTcl } from '~/server/db/import-tcl'
import { importSfl } from '~/server/db/import-sfl'
import { importMscl } from '~/server/db/import-mscl'
import { importAredl } from '~/server/db/import-aredl'
import { importAredlHistory } from '~/server/db/import-aredl-history'
import { importPointercrate } from '~/server/db/import-pointercrate'
import { importCl } from '~/server/db/import-cl'
import { importGsv } from '~/server/db/import-gsv'

/**
 * Each runner takes a reporter so the admin panel can show a progress bar
 * instead of a pulsing "Running" chip that means the same thing at ten seconds
 * and at ten minutes. Importers that don't report yet simply don't call it, and
 * the bar stays indeterminate — which is honest.
 */
const RUNNERS: Record<string, (report: ProgressReporter) => Promise<void>> = {
  'sheet':         async (r) => { await runImport(r) },
  'sheet-pending': async (r) => { await importPendingList(r) },
  'gdl':           async (r) => { await importGdl(r) },
  'tsl':           async (r) => { await importTsl(r) },
  'edi':           async (r) => { await importEdi(r) },
  'ccl':           async (r) => { await importCcl(r) },
  'ddl':           async (r) => { await importDdl(r) },
  'll':            async (r) => { await importLl(r) },
  'tcl':           async (r) => { await importTcl(r) },
  'sfl':           async (r) => { await importSfl(r) },
  'mscl':          async (r) => { await importMscl(r) },
  'aredl':         async (r) => { await importAredl(r) },
  'aredl-history': async (r) => { await importAredlHistory(r) },
  'pointercrate':  async (r) => { await importPointercrate(r) },
  'cl':            async (r) => { await importCl(r) },
  'gsv':           async (r) => { await importGsv(r) },
}

// Runs the import, then checks for a queued follow-up and starts it if needed.
async function runWithQueue(source: string, runner: (r: ProgressReporter) => Promise<void>): Promise<void> {
  const t0 = Date.now()
  const report: ProgressReporter = (patch) => setImportProgress(source, patch)
  try {
    console.log(`[admin/imports] starting ${source}`)
    await runner(report)
    console.log(`[admin/imports] finished ${source} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } catch (err) {
    console.error(`[admin/imports] ${source} failed:`, err)
  } finally {
    finishImport(source)
    // A fresh import is exactly when the ALL and that list can start
    // disagreeing, so don't make the tab wait out its cache.
    invalidateImportedMovementSummary()
    if (dequeueImport(source)) {
      startImport(source)
      runWithQueue(source, runner).catch(() => {})
    }
  }
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<{ source?: string }>(event)
  const source = String(body?.source ?? '').toLowerCase()
  const runner = RUNNERS[source]
  if (!runner) {
    throw createError({ statusCode: 400, statusMessage: `Unknown source: ${source}` })
  }

  // If already running, queue a follow-up run unless one is already queued.
  if (isImportRunning(source)) {
    if (isImportQueued(source)) {
      return { ok: true, source, started: false, queued: false, message: 'Already queued.' }
    }
    queueImport(source)
    return { ok: true, source, started: false, queued: true }
  }

  if (!startImport(source)) {
    // Race condition — queue it.
    queueImport(source)
    return { ok: true, source, started: false, queued: true }
  }

  // Fire and forget — the importers can take minutes; tying the response to
  // their completion would time the request out and the admin UI polls the
  // status endpoint anyway.
  runWithQueue(source, runner).catch(() => {})

  return { ok: true, source, started: true, queued: false }
})

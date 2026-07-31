import { requireAdmin } from '~/server/utils/auth'
import { isImportRunning, startImport, finishImport, queueImport, isImportQueued, dequeueImport } from '~/server/utils/imports-state'
import { importPendingList, runImport } from '~/server/db/import'
import { importGdl } from '~/server/db/import-gdl'
import { importTsl } from '~/server/db/import-tsl'
import { importEdi } from '~/server/db/import-edi'
import { importCcl } from '~/server/db/import-ccl'
import { importDdl } from '~/server/db/import-ddl'
import { importLl } from '~/server/db/import-ll'
import { importTcl } from '~/server/db/import-tcl'
import { importSfl } from '~/server/db/import-sfl'
import { importAredl } from '~/server/db/import-aredl'
import { importAredlHistory } from '~/server/db/import-aredl-history'
import { importPointercrate } from '~/server/db/import-pointercrate'
import { importCl } from '~/server/db/import-cl'
import { importGsv } from '~/server/db/import-gsv'

const RUNNERS: Record<string, () => Promise<void>> = {
  'sheet':         async () => { await runImport() },
  'sheet-pending': async () => { await importPendingList() },
  'gdl':           async () => { await importGdl() },
  'tsl':           async () => { await importTsl() },
  'edi':           async () => { await importEdi() },
  'ccl':           async () => { await importCcl() },
  'ddl':           async () => { await importDdl() },
  'll':            async () => { await importLl() },
  'tcl':           async () => { await importTcl() },
  'sfl':           async () => { await importSfl() },
  'aredl':         async () => { await importAredl() },
  'aredl-history': async () => { await importAredlHistory() },
  'pointercrate':  async () => { await importPointercrate() },
  'cl':            async () => { await importCl() },
  'gsv':           async () => { await importGsv() },
}

// Runs the import, then checks for a queued follow-up and starts it if needed.
async function runWithQueue(source: string, runner: () => Promise<void>): Promise<void> {
  const t0 = Date.now()
  try {
    console.log(`[admin/imports] starting ${source}`)
    await runner()
    console.log(`[admin/imports] finished ${source} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } catch (err) {
    console.error(`[admin/imports] ${source} failed:`, err)
  } finally {
    finishImport(source)
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

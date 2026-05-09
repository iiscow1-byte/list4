import { requireAdmin } from '~/server/utils/auth'
import { isImportRunning, startImport, finishImport } from '~/server/utils/imports-state'
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
  'pointercrate':  async () => { await importPointercrate() },
  'cl':            async () => { await importCl() },
  'gsv':           async () => { await importGsv() },
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<{ source?: string }>(event)
  const source = String(body?.source ?? '').toLowerCase()
  const runner = RUNNERS[source]
  if (!runner) {
    throw createError({ statusCode: 400, statusMessage: `Unknown source: ${source}` })
  }
  if (isImportRunning(source) || isImportRunning('sheet')) {
    throw createError({ statusCode: 409, statusMessage: `An import is already running.` })
  }
  if (!startImport(source)) {
    throw createError({ statusCode: 409, statusMessage: `Import for ${source} is already running.` })
  }

  // Fire and forget — the importers can take minutes; tying the response to
  // their completion would time the request out and the admin UI polls the
  // status endpoint anyway.
  ;(async () => {
    const t0 = Date.now()
    try {
      console.log(`[admin/imports] starting ${source}`)
      await runner()
      console.log(`[admin/imports] finished ${source} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    } catch (err) {
      console.error(`[admin/imports] ${source} failed:`, err)
    } finally {
      finishImport(source)
    }
  })()

  return { ok: true, source, started: true }
})

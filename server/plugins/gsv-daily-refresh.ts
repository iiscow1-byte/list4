import { importGsv } from '~/server/db/import-gsv'

/**
 * Scheduled GSV refresh: fires at 00:00 UTC each day.
 *
 * The first tick aligns to the next UTC midnight, then a 24h interval keeps
 * it running. A `running` guard prevents overlap if the import takes longer
 * than expected. Skipped when LIST_SKIP_GSV_IMPORT=1 (the same env var that
 * gates the boot-time import in db-init.ts).
 */
export default defineNitroPlugin(() => {
  if (process.env.LIST_SKIP_GSV_IMPORT === '1') return

  const DAY_MS = 24 * 60 * 60 * 1000
  let running = false

  const tick = async () => {
    if (running) {
      console.warn('[gsv-cron] previous import still running — skipping this tick')
      return
    }
    running = true
    try {
      console.log('[gsv-cron] starting scheduled Global Stats Viewer import')
      await importGsv()
    } catch (err) {
      console.error('[gsv-cron] import failed:', err)
    } finally {
      running = false
    }
  }

  const now = new Date()
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ))
  const msUntilMidnight = nextMidnight.getTime() - now.getTime()

  const initial = setTimeout(() => {
    tick()
    const interval = setInterval(tick, DAY_MS)
    if ('unref' in interval) (interval as any).unref()
  }, msUntilMidnight)
  if ('unref' in initial) (initial as any).unref()
})

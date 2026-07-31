import { runImport } from '~/server/db/import'

/**
 * Scheduled sheet refresh: re-pulls the source Google Sheet so placements on
 * the site follow the curators' edits without anyone running a command.
 *
 * The importer is already idempotent — it matches sheet rows to existing
 * levels on (gd_id, name), so a re-run repositions rows instead of inserting
 * duplicates, and `cleanupDuplicateLevels` sweeps up anything older imports
 * left behind. Placement changes are written to the changelog by
 * `recordSheetMovements`, which only logs levels whose rank changed relative
 * to their peers, so a refresh that merely adds levels doesn't spam it.
 *
 * Interval is configurable via LIST_SHEET_REFRESH_HOURS (default 6). Set
 * LIST_SKIP_SHEET_REFRESH=1 to turn it off — useful in development, where a
 * ~90s import competing for the SQLite write lock is just noise.
 */
export default defineNitroPlugin(() => {
  if (process.env.LIST_SKIP_SHEET_REFRESH === '1') return

  const hours = Math.max(1, Number(process.env.LIST_SHEET_REFRESH_HOURS) || 6)
  const intervalMs = hours * 60 * 60 * 1000
  let running = false

  const tick = async () => {
    if (running) {
      console.warn('[sheet-cron] previous refresh still running — skipping this tick')
      return
    }
    running = true
    try {
      console.log('[sheet-cron] starting scheduled sheet refresh')
      await runImport()
      console.log('[sheet-cron] refresh complete')
    } catch (err) {
      console.error('[sheet-cron] refresh failed:', err)
    } finally {
      running = false
    }
  }

  // Wait one full interval before the first run: boot already triggers an
  // import when the database is empty (see db-init.ts), and a fresh deploy
  // shouldn't immediately re-pull a sheet it just read.
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  console.log(`[sheet-cron] scheduled sheet refresh every ${hours}h`)
})

import { postDailyChangesIfDue } from '~/server/utils/daily-discord'

/**
 * Polls every ~10 minutes and triggers the daily Discord changes summary
 * when a UTC day rolls over. The "is it due?" guard lives inside
 * postDailyChangesIfDue so manual triggers and the cron use identical logic.
 *
 * Skipped when LIST_SKIP_DAILY_DISCORD=1 (handy for local dev / tests).
 */
export default defineNitroPlugin(() => {
  if (process.env.LIST_SKIP_DAILY_DISCORD === '1') return

  const POLL_MS = 10 * 60 * 1000
  const tick = async () => {
    try {
      const result = await postDailyChangesIfDue()
      if (result.posted.length) {
        console.log(
          `[daily-discord] posted ${result.posted.length} entr${result.posted.length === 1 ? 'y' : 'ies'}: `
          + result.posted.map((p) => `wh${p.webhookId}/${p.date}=${p.status}`).join(' '),
        )
      }
    } catch (e: any) {
      console.error('[daily-discord] tick failed:', e?.message ?? e)
    }
  }

  // Defer the first tick a bit so the DB / migrations finish first.
  const initial = setTimeout(tick, 60_000)
  if ('unref' in initial) initial.unref()
  const interval = setInterval(tick, POLL_MS)
  if ('unref' in interval) interval.unref()
})

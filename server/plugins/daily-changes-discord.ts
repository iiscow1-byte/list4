import { postDailyChangesIfDue } from '~/server/utils/daily-discord'

/**
 * Sends the daily changelog digest shortly after each UTC midnight.
 *
 * Off in `nuxt dev` unless `LIST_DAILY_DISCORD=1`: a local server running on a
 * copy of the production database would otherwise post to the real channels.
 * `LIST_SKIP_DAILY_DISCORD=1` turns it off anywhere.
 */
export default defineNitroPlugin(() => {
  if (process.env.LIST_SKIP_DAILY_DISCORD === '1') return
  if (import.meta.dev && process.env.LIST_DAILY_DISCORD !== '1') {
    console.log('[daily-discord] not running in dev (set LIST_DAILY_DISCORD=1 to enable)')
    return
  }

  const tick = async () => {
    try {
      const { posted } = await postDailyChangesIfDue({ mode: 'scheduled' })
      if (posted.length) {
        console.log(`[daily-discord] ${posted.map((p) => `webhook ${p.webhookId}: ${p.window}: ${p.status}`).join('; ')}`)
      }
    } catch (e: any) {
      console.error('[daily-discord] tick failed:', e?.message ?? e)
    }
  }

  const first = setTimeout(tick, 60_000)
  first.unref?.()
  const timer = setInterval(tick, 10 * 60_000)
  timer.unref?.()
})

import { requireAdmin } from '~/server/utils/auth'
import { startWarmer, getWarmerStatus } from '~/server/utils/gd-cache-warmer'

/**
 * Kick off the GD cache warmer in the background. No-op (returns started=false)
 * if the warmer is already running. The actual loop runs in this Node process —
 * progress only logs to the server stdout, with a heartbeat every 60 seconds.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const result = startWarmer()
  return {
    ok: true,
    started: result.started,
    alreadyRunning: !result.started,
    status: result.status,
  }
})

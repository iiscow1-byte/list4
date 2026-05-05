import { requireAdmin } from '~/server/utils/auth'
import { postDailyChangesIfDue } from '~/server/utils/daily-discord'

/**
 * Post the last complete day's changes (up to yesterday UTC). Mirrors what
 * the auto-scheduler does at midnight, but triggered on demand. Does not
 * include partial today-changes — use post-now for that.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const result = await postDailyChangesIfDue({ allWebhooks: true })
  return result
})

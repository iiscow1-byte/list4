import { requireAdmin } from '~/server/utils/auth'
import { postDailyChangesIfDue, ymdUtc } from '~/server/utils/daily-discord'

/**
 * Manually run the daily-changes posting routine. Extends the window to
 * today (UTC) so changes made earlier today are included — the scheduler
 * only runs up to yesterday to avoid posting a partial day automatically.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const result = await postDailyChangesIfDue({ upToDate: ymdUtc(new Date()), forceCurrent: true, allWebhooks: true })
  return result
})

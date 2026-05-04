import { requireAdmin } from '~/server/utils/auth'
import { postDailyChangesIfDue } from '~/server/utils/daily-discord'

/**
 * Manually run the daily-changes posting routine. Useful for catching up
 * after long downtime or for sanity-checking the format. Same guard as the
 * scheduler — won't double-post a day that's already been sent.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const result = await postDailyChangesIfDue()
  return result
})

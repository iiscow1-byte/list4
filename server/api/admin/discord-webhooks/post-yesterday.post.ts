import { requireAdmin } from '~/server/utils/auth'
import { postDailyChangesIfDue } from '~/server/utils/daily-discord'

/** Send any finished day not yet sent, the same as the nightly run does. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  return postDailyChangesIfDue({ mode: 'scheduled', includePaused: true })
})

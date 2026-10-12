import { requireAdmin } from '~/server/utils/auth'
import { postDailyChangesIfDue } from '~/server/utils/daily-discord'

/**
 * Send everything not yet sent, including today so far. Tonight's digest then
 * only carries what happens after this.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<{ id?: number }>(event).catch(() => null)
  return postDailyChangesIfDue({ mode: 'now', includePaused: true, webhookId: body?.id ? Number(body.id) : undefined })
})

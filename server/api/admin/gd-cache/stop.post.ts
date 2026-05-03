import { requireAdmin } from '~/server/utils/auth'
import { stopWarmer, getWarmerStatus } from '~/server/utils/gd-cache-warmer'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const stopped = stopWarmer()
  return { ok: true, stopped, status: getWarmerStatus() }
})

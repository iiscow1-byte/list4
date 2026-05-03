import { requireAdmin } from '~/server/utils/auth'
import { getWarmerStatus } from '~/server/utils/gd-cache-warmer'

export default defineEventHandler((event) => {
  requireAdmin(event)
  return getWarmerStatus()
})

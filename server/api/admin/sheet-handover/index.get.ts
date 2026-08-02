import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { handoverCandidates } from '~/server/utils/sheet-handover'

/**
 * Levels the site owns rather than the sheet, and whether the sheet has a row
 * ready to take each one over.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const items = handoverCandidates(getDb())
  return {
    items,
    total: items.length,
    matched: items.filter((i) => i.sheet).length,
  }
})

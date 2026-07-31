import { getDb } from '~/server/db'
import { groupByDay, loadChanges } from '~/server/utils/changes'

/**
 * Recent main-list changes grouped by UTC day, newest first. Powers the
 * Recent Changes section on the about page. Limit caps the row count *before*
 * grouping so a chatty day doesn't crowd out older ones.
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = Math.max(1, Math.min(Number(q.days) || 14, 3650))
  const limit = Math.max(1, Math.min(Number(q.limit) || 300, 2000))
  // 'all' = native moves only, 'aredl' = imported AREDL history, omitted = both.
  const source = q.source === 'all' || q.source === 'aredl' ? String(q.source) : undefined

  // `days` ago at 00:00 UTC.
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')

  const db = getDb()
  const changes = loadChanges(db, { since, limit, source })
  const grouped = groupByDay(changes)
  return { days: grouped }
})

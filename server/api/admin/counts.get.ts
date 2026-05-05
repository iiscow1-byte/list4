import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireMod(event)
  const db = getDb()
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n

  return {
    records:              count(`SELECT COUNT(*) AS n FROM records               WHERE permanent = 0`),
    opinions:             count(`SELECT COUNT(*) AS n FROM opinions              WHERE status = 'pending'`),
    levels:               count(`SELECT COUNT(*) AS n FROM pending_levels        WHERE status = 'pending'`),
    awaiting:             count(`SELECT COUNT(*) AS n FROM awaiting_levels`),
    'open-verifications': count(`SELECT COUNT(*) AS n FROM open_verifications    WHERE status = 'pending'`),
    claims:               count(`SELECT COUNT(*) AS n FROM claim_requests        WHERE status = 'pending'`),
  }
})

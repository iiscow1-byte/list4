import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const db = getDb()
  const body = (await readBody<{ counts?: Record<string, number>; markAll?: boolean }>(event)) ?? {}

  let counts: Record<string, number>
  if (body.markAll) {
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n
    counts = {
      records:              n(`SELECT COUNT(*) AS n FROM records             WHERE permanent = 0`),
      opinions:             n(`SELECT COUNT(*) AS n FROM opinions            WHERE status = 'pending'`),
      levels:               n(`SELECT COUNT(*) AS n FROM pending_levels      WHERE status = 'pending'`),
      awaiting:             n(`SELECT COUNT(*) AS n FROM awaiting_levels`),
      movements:            n(`SELECT COUNT(*) AS n FROM pending_movements   WHERE status = 'pending'`),
      'open-verifications': n(`SELECT COUNT(*) AS n FROM open_verifications  WHERE status = 'pending'`),
      claims:               n(`SELECT COUNT(*) AS n FROM claim_requests      WHERE status = 'pending'`),
    }
  } else if (body.counts && typeof body.counts === 'object') {
    counts = body.counts
  } else {
    return { ok: true }
  }

  const upsert = db.prepare(
    `INSERT INTO admin_seen_counts (account_id, tab_id, seen) VALUES (?, ?, ?)
     ON CONFLICT(account_id, tab_id) DO UPDATE SET seen = excluded.seen`,
  )
  for (const [tabId, seen] of Object.entries(counts)) {
    if (typeof seen === 'number') upsert.run(account.id, tabId, seen)
  }

  return { ok: true }
})

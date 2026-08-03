import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * The accounts list, with every claim each one holds.
 *
 * External claims (AREDL, GDL, Pointercrate) come with the player's name from
 * the mirror and the number of records the claim put on their profile, because
 * that count is what an admin about to release a claim needs to know: unclaiming
 * takes those records off the profile, and saying how many beforehand is the
 * difference between an informed decision and a surprise.
 */
const COLS = `
  a.id, a.username, a.role, a.claimed_player, a.created_at, a.banned_at, a.banned_reason,
  a.claimed_aredl_uuid, a.claimed_gdl_id, a.claimed_pointercrate_id,
  ap.global_name AS claimed_aredl_name,
  gp.username    AS claimed_gdl_name,
  pp.name        AS claimed_pointercrate_name
`
const JOINS = `
  FROM accounts a
  LEFT JOIN aredl_players        ap ON ap.uuid  = a.claimed_aredl_uuid
  LEFT JOIN gdl_players          gp ON gp.gdl_id = a.claimed_gdl_id
  LEFT JOIN pointercrate_players pp ON pp.pc_id  = a.claimed_pointercrate_id
`

export default defineEventHandler((event) => {
  requireAdmin(event)
  const q = getQuery(event)
  const search = typeof q.search === 'string' ? q.search.trim() : ''

  const db = getDb()
  const rows = (search
    ? db.prepare(
        `SELECT ${COLS} ${JOINS}
          WHERE a.username LIKE ? COLLATE NOCASE OR a.claimed_player LIKE ? COLLATE NOCASE
          ORDER BY a.created_at DESC LIMIT 200`,
      ).all(`%${search}%`, `%${search}%`)
    : db.prepare(
        `SELECT ${COLS} ${JOINS} ORDER BY a.created_at DESC LIMIT 200`,
      ).all()) as any[]

  // One grouped count for the page rather than a correlated subquery per row.
  const counts = new Map<string, number>()
  for (const r of db.prepare(
    `SELECT claim_account_id AS id, claim_source AS source, COUNT(*) AS n
       FROM records WHERE claim_source IS NOT NULL AND claim_account_id IS NOT NULL
      GROUP BY claim_account_id, claim_source`,
  ).all() as { id: number; source: string; n: number }[]) {
    counts.set(`${r.id}|${r.source}`, r.n)
  }
  for (const r of rows) {
    r.claimed_records = {
      aredl: counts.get(`${r.id}|aredl`) ?? 0,
      gdl: counts.get(`${r.id}|gdl`) ?? 0,
      pointercrate: counts.get(`${r.id}|pointercrate`) ?? 0,
    }
  }

  return { items: rows }
})

import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'

/**
 * Global leaderboard — players from every external list we mirror, with the
 * existing /leaderboard reserved for the canonical ALL-list players.
 *
 * Currently surfaces only Aredl. As more list integrations land they can be
 * UNION'd in here with a `source` discriminator on each row.
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.max(1, Math.min(500, Number(q.limit) || 200))
  const search = String(q.q ?? '').trim()
  const source = String(q.source ?? 'all').toLowerCase()

  const db = getDb()
  const rows: any[] = []

  if (source === 'all' || source === 'aredl') {
    const params: any[] = []
    let where = ''
    if (search) {
      where = `WHERE ap.global_name LIKE ? COLLATE NOCASE OR ap.username LIKE ? COLLATE NOCASE`
      const like = `%${search}%`
      params.push(like, like)
    }
    const sql = `
      SELECT ap.uuid, ap.global_name AS player, ap.username, ap.country,
             ap.total_points, ap.pack_points, ap.extremes, ap.rank,
             ap.hardest_name, ap.claimed_account_id,
             a.username AS claimed_username, a.role AS role,
             'aredl' AS source
        FROM aredl_players ap
        LEFT JOIN accounts a ON a.id = ap.claimed_account_id
       ${where}
       ORDER BY ap.total_points DESC, ap.global_name COLLATE NOCASE ASC
       LIMIT ?
    `
    params.push(limit)
    const aredlRows = db.prepare(sql).all(...params) as any[]
    for (const r of aredlRows) {
      rows.push({
        rank: r.rank,
        source: 'aredl',
        uuid: r.uuid,
        player: r.player,
        country: countryNumericToAlpha2(r.country),
        points: r.total_points,
        pack_points: r.pack_points,
        extremes: r.extremes,
        hardest: r.hardest_name,
        // Role badge intentionally omitted — AREDL leaderboard rows are list
        // mirrors, not site identities, so the site-role chip would be
        // misleading here. The "Claimed" pill in the UI is enough.
        claimed_account: r.claimed_username
          ? { username: r.claimed_username }
          : null,
      })
    }
  }

  return { total: rows.length, items: rows }
})

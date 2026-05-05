import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'

/**
 * Global leaderboard — players from every external list we mirror, with the
 * existing /leaderboard reserved for the canonical ALL-list players.
 *
 * Aredl + Pointercrate currently. Each source has its own row shape (Aredl
 * uses int total_points, Pointercrate uses float score) so they're unioned
 * on a normalized `points` field for sorting + display.
 *
 * `source` query param: 'all' (default), 'aredl', or 'pointercrate'.
 */

type Row = {
  rank: number
  source: 'aredl' | 'pointercrate' | 'alllist'
  /** uuid for aredl, pc_id for pointercrate, player name for alllist */
  id: string | number
  player: string
  country: string | null
  points: number
  extras: { extremes?: number; pack_points?: number }
  hardest: string | null
  claimed_account: { username: string } | null
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.max(1, Math.min(500, Number(q.limit) || 200))
  const search = String(q.q ?? '').trim()
  const source = String(q.source ?? 'all').toLowerCase()
  // 'all' merges every source including the ALL list; individual sources can
  // be requested by their name; 'alllist' targets the ALL list specifically.

  const db = getDb()
  const rows: Row[] = []

  if (source === 'all' || source === 'aredl') {
    const params: any[] = []
    let where = ''
    if (search) {
      where = `WHERE ap.global_name LIKE ? COLLATE NOCASE OR ap.username LIKE ? COLLATE NOCASE`
      const like = `%${search}%`
      params.push(like, like)
    }
    const sql = `
      SELECT ap.uuid, ap.global_name AS player, ap.country,
             ap.total_points, ap.pack_points, ap.extremes, ap.rank,
             ap.hardest_name,
             a.username AS claimed_username
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
        id: r.uuid,
        player: r.player,
        country: countryNumericToAlpha2(r.country),
        points: r.total_points,
        extras: { extremes: r.extremes, pack_points: r.pack_points },
        hardest: r.hardest_name,
        claimed_account: r.claimed_username ? { username: r.claimed_username } : null,
      })
    }
  }

  if (source === 'all' || source === 'pointercrate') {
    const params: any[] = []
    let where = `WHERE pp.banned = 0`
    if (search) {
      where += ` AND pp.name LIKE ? COLLATE NOCASE`
      params.push(`%${search}%`)
    }
    const sql = `
      SELECT pp.pc_id, pp.name AS player, pp.nationality, pp.score, pp.rank,
             pp.hardest_name,
             a.username AS claimed_username
        FROM pointercrate_players pp
        LEFT JOIN accounts a ON a.id = pp.claimed_account_id
       ${where}
       ORDER BY pp.score DESC, pp.name COLLATE NOCASE ASC
       LIMIT ?
    `
    params.push(limit)
    const pcRows = db.prepare(sql).all(...params) as any[]
    for (const r of pcRows) {
      rows.push({
        rank: r.rank,
        source: 'pointercrate',
        id: r.pc_id,
        player: r.player,
        country: r.nationality,
        points: r.score,
        extras: {},
        hardest: r.hardest_name,
        claimed_account: r.claimed_username ? { username: r.claimed_username } : null,
      })
    }
  }

  if (source === 'all' || source === 'alllist') {
    const params: any[] = []
    let where = ''
    if (search) {
      where = `WHERE p.name LIKE ? COLLATE NOCASE`
      params.push(`%${search}%`)
    }
    const sql = `
      SELECT p.name AS player, p.country, p.total_points AS points, p.hardest,
             a.username AS claimed_username
        FROM players p
        LEFT JOIN accounts a ON LOWER(a.claimed_player) = LOWER(p.name)
       ${where}
       ORDER BY p.total_points DESC, p.name COLLATE NOCASE ASC
       LIMIT ?
    `
    params.push(limit)
    const allRows = db.prepare(sql).all(...params) as any[]
    let allRank = 1
    for (const r of allRows) {
      rows.push({
        rank: allRank++,
        source: 'alllist',
        id: r.player,
        player: r.player,
        country: r.country,
        points: r.points ?? 0,
        extras: {},
        hardest: r.hardest,
        claimed_account: r.claimed_username ? { username: r.claimed_username } : null,
      })
    }
  }

  // Re-rank merged results by points.
  if (source === 'all') {
    rows.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
  }

  return { total: rows.length, items: rows.slice(0, limit) }
})

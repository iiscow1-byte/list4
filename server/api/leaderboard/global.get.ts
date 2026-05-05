import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'
import { listDerivedPlayers } from '~/server/utils/leaderboard'

/**
 * Global leaderboard — players from AREDL, Pointercrate, and the ALL list.
 *
 * When source='all' (All Lists), each source gets an equal slice of the limit
 * so ALL list players always appear alongside AREDL and Pointercrate players.
 * Each player's rank reflects their standing within their own source list.
 */

type Row = {
  rank: number
  source: 'aredl' | 'pointercrate' | 'alllist'
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

  // For the combined 'all' view, divide the limit equally across sources so
  // every list is represented. For single-source views, use the full limit.
  const sourcesInView = (source === 'all' ? 3 : 1)
  const subLimit = Math.ceil(limit / sourcesInView)

  const db = getDb()
  const rows: Row[] = []

  if (source === 'all' || source === 'aredl') {
    const params: any[] = []
    let where = ''
    if (search) {
      where = `WHERE ap.global_name LIKE ? COLLATE NOCASE OR ap.username LIKE ? COLLATE NOCASE`
      params.push(`%${search}%`, `%${search}%`)
    }
    const sql = `
      SELECT ap.uuid, ap.global_name AS player, ap.country,
             ap.total_points, ap.pack_points, ap.extremes, ap.rank,
             ap.hardest_name,
             a.username AS claimed_username
        FROM aredl_players ap
        LEFT JOIN accounts a ON a.id = ap.claimed_account_id
       ${where}
       ORDER BY ap.rank ASC, ap.global_name COLLATE NOCASE ASC
       LIMIT ?
    `
    params.push(subLimit)
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
       ORDER BY pp.rank ASC, pp.name COLLATE NOCASE ASC
       LIMIT ?
    `
    params.push(subLimit)
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
    // Same three-category logic as leaderboard.get.ts so all accounts appear:
    // 1. sheet players, 2. derived (records-only), 3. zero-point registered accounts
    type AllEntry = {
      player: string
      country: string | null
      points: number
      hardest: string | null
      claimed_username: string | null
      extremes: number
    }

    // Count accepted records per ALL list player (every ALL list level is an extreme).
    const extremesMap = new Map<string, number>()
    ;(db.prepare(
      `SELECT LOWER(player_name) AS k, COUNT(*) AS n FROM records WHERE permanent = 1 GROUP BY LOWER(player_name)`,
    ).all() as { k: string; n: number }[]).forEach((r) => extremesMap.set(r.k, r.n))

    const sheetRows = db.prepare(
      `SELECT p.name AS player, p.country, p.total_points AS points, p.hardest,
              MAX(a.username) AS claimed_username
         FROM players p
         LEFT JOIN accounts a ON LOWER(a.claimed_player) = LOWER(p.name)
        GROUP BY p.name`,
    ).all() as any[]

    const allEntries: AllEntry[] = sheetRows.map((r: any) => ({
      player: r.player,
      country: r.country,
      points: r.points ?? 0,
      hardest: r.hardest,
      claimed_username: r.claimed_username,
      extremes: extremesMap.get(r.player.toLowerCase()) ?? 0,
    }))

    const seenAll = new Set<string>(allEntries.map((e) => e.player.toLowerCase()))

    for (const d of listDerivedPlayers(db)) {
      if (seenAll.has(d.name.toLowerCase())) continue
      seenAll.add(d.name.toLowerCase())
      const acc = db.prepare(
        `SELECT username FROM accounts WHERE LOWER(claimed_player) = LOWER(?) AND banned_at IS NULL LIMIT 1`,
      ).get(d.name) as { username: string } | undefined
      allEntries.push({
        player: d.name,
        country: null,
        points: d.total_points,
        hardest: d.hardest,
        claimed_username: acc?.username ?? null,
        extremes: extremesMap.get(d.name.toLowerCase()) ?? 0,
      })
    }

    for (const a of db.prepare(
      `SELECT username, claimed_player, country FROM accounts WHERE banned_at IS NULL`,
    ).all() as { username: string; claimed_player: string | null; country: string | null }[]) {
      const name = a.claimed_player ?? a.username
      if (seenAll.has(name.toLowerCase())) continue
      seenAll.add(name.toLowerCase())
      allEntries.push({ player: name, country: a.country, points: 0, hardest: null, claimed_username: a.username, extremes: extremesMap.get(name.toLowerCase()) ?? 0 })
    }

    allEntries.sort((a, b) => {
      const dp = (b.points ?? 0) - (a.points ?? 0)
      return dp !== 0 ? dp : a.player.localeCompare(b.player, undefined, { sensitivity: 'base' })
    })

    // Assign true ranks before filtering so search shows the real global rank.
    const ranked = allEntries.map((e, i) => ({ ...e, rank: i + 1 }))
    const needle = search.toLowerCase()
    const filtered = search ? ranked.filter((e) => e.player.toLowerCase().includes(needle)) : ranked

    for (const r of filtered.slice(0, subLimit)) {
      rows.push({
        rank: r.rank,
        source: 'alllist',
        id: r.player,
        player: r.player,
        country: r.country,
        points: r.points,
        extras: { extremes: r.extremes },
        hardest: r.hardest,
        claimed_account: r.claimed_username ? { username: r.claimed_username } : null,
      })
    }
  }

  // For combined view: sort by points descending so the highest-scoring player
  // appears first. Source-specific ranks (AREDL rank, PC rank, ALL list rank)
  // are preserved so a player's displayed rank always reflects their real
  // standing in their own list, unaffected by search filtering.
  if (source === 'all') {
    rows.sort((a, b) => {
      const dp = (b.points ?? 0) - (a.points ?? 0)
      return dp !== 0 ? dp : a.player.localeCompare(b.player, undefined, { sensitivity: 'base' })
    })
  }

  return { total: rows.length, items: rows.slice(0, limit) }
})

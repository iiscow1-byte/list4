import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'
import { listDerivedPlayers } from '~/server/utils/leaderboard'

/**
 * Global leaderboard — players from AREDL, Pointercrate, and the ALL list.
 *
 * For source='all' (All Lists): ALL rows from every source are fetched (no SQL
 * search filter, no per-source limit), merged, sorted by points, and given
 * unified ranks 1,2,3… THEN the search filter is applied in code so a player's
 * displayed rank always reflects their true global cross-list standing regardless
 * of what was searched.
 *
 * For single-source views: search and limit are pushed into SQL as before.
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

  const db = getDb()
  const rows: Row[] = []

  // For the combined 'all' view, skip per-source search/limit so we can build
  // a complete globally-ranked set and apply search after unified ranking.
  const isCombined = source === 'all'

  if (source === 'all' || source === 'aredl') {
    const params: any[] = []
    let where = ''
    if (search && !isCombined) {
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
       ${isCombined ? '' : 'LIMIT ?'}
    `
    if (!isCombined) params.push(limit)
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
    if (search && !isCombined) {
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
       ${isCombined ? '' : 'LIMIT ?'}
    `
    if (!isCombined) params.push(limit)
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
    type AllEntry = {
      player: string
      country: string | null
      points: number
      hardest: string | null
      claimed_username: string | null
      extremes: number
    }

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

    // For single-source view: assign per-source ranks, then filter by search.
    // For combined view: push all entries unfiltered — unified ranking happens below.
    const ranked = allEntries.map((e, i) => ({ ...e, rank: i + 1 }))
    const sourceEntries = (!isCombined && search)
      ? ranked.filter((e) => e.player.toLowerCase().includes(search.toLowerCase()))
      : ranked

    for (const r of (isCombined ? sourceEntries : sourceEntries.slice(0, limit))) {
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

  if (isCombined) {
    // Sort all sources by points and assign unified ranks 1,2,3… across all lists.
    rows.sort((a, b) => {
      const dp = (b.points ?? 0) - (a.points ?? 0)
      return dp !== 0 ? dp : a.player.localeCompare(b.player, undefined, { sensitivity: 'base' })
    })
    rows.forEach((r, i) => { r.rank = i + 1 })

    // Apply search AFTER ranking so the displayed rank always reflects true
    // global standing, not position within the filtered result set.
    const visible = search
      ? rows.filter((r) => r.player.toLowerCase().includes(search.toLowerCase()))
      : rows
    return { total: visible.length, items: visible.slice(0, limit) }
  }

  return { total: rows.length, items: rows.slice(0, limit) }
})

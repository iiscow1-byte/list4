import { getDb } from '~/server/db'
import { countryNumericToAlpha2 } from '~/utils/country-codes'
import { listDerivedPlayers } from '~/server/utils/leaderboard'
import { clanTagsForPlayers, type ClanBadge } from '~/server/utils/clans'
import { aredlAvatarsForPlayers } from '~/server/utils/aredl-avatars'
import { discordAvatarUrl } from '~/utils/discord-avatar'

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

type Source = 'aredl' | 'pointercrate' | 'gdl' | 'alllist'
type Row = {
  rank: number
  // Primary source (used for routing — AREDL UUID > PC ID > player name).
  source: Source
  // Sources this row appears on. Single-source views always have one entry.
  // The All Lists view merges duplicate players across sources into one row,
  // and `sources` carries the full list so the chip can show "AREDL/PC" etc.
  sources: Source[]
  id: string | number
  player: string
  country: string | null
  points: number
  extras: { extremes?: number; pack_points?: number }
  hardest: string | null
  claimed_account: { username: string; has_avatar: boolean } | null
  clan?: ClanBadge | null
  /**
   * Discord avatar via AREDL, for a player with no account here. Never
   * consulted when `claimed_account.has_avatar` is true — this is the picture
   * for the very many ranked players who have never signed up, not an
   * alternative to the one somebody chose on this site.
   */
  aredl_avatar_url?: string | null
}

/**
 * Attach what a row needs from the site's own accounts, for the page being
 * returned only.
 *
 * The claim join upstream gives a username but says nothing about whether that
 * account has a picture, and the page rendered every row's initial instead —
 * on the tab the leaderboard opens on. Doing it here rather than in the joins
 * keeps it to one query over at most a page's worth of names, not tens of
 * thousands of blob checks. The clan tag is attached the same way and for the
 * same reason.
 *
 * A clan is looked up by the *player* name rather than the claimed username,
 * because that is the name the record is filed under and the name this row is
 * printed with — matching the rule `server/utils/clans.ts` uses everywhere.
 */
function attachAccountBits(db: ReturnType<typeof getDb>, rows: Row[]): Row[] {
  const clans = clanTagsForPlayers(db, rows.map((r) => r.player))
  for (const r of rows) r.clan = clans.get(r.player.toLowerCase()) ?? null

  const names = [...new Set(
    rows.map((r) => r.claimed_account?.username).filter((u): u is string => !!u),
  )]
  // Not an early return: a page where nobody has claimed an account is exactly
  // the page the AREDL fallback below exists for.
  if (names.length) {
    const ph = names.map(() => '?').join(',')
    const withAvatar = new Set(
      (db.prepare(
        `SELECT username FROM accounts
          WHERE avatar_blob IS NOT NULL AND username COLLATE NOCASE IN (${ph})`,
      ).all(...names) as { username: string }[]).map((a) => a.username.toLowerCase()),
    )
    for (const r of rows) {
      if (r.claimed_account) {
        r.claimed_account = {
          ...r.claimed_account,
          has_avatar: withAvatar.has(r.claimed_account.username.toLowerCase()),
        }
      }
    }
  }

  /**
   * AREDL faces for whatever is still blank.
   *
   * The AREDL branch below fills these in directly from the row it already
   * read, so this only catches rows that came from Pointercrate, GDL or the ALL
   * and happen to name somebody AREDL also knows. A row whose account has its
   * own avatar is skipped: that picture wins, always.
   */
  const faceless = rows
    .filter((r) => !r.aredl_avatar_url && !r.claimed_account?.has_avatar)
    .map((r) => r.player)
  if (faceless.length) {
    const faces = aredlAvatarsForPlayers(db, faceless)
    if (faces.size) {
      for (const r of rows) {
        if (r.aredl_avatar_url || r.claimed_account?.has_avatar) continue
        r.aredl_avatar_url = faces.get(r.player.toLowerCase()) ?? null
      }
    }
  }
  return rows
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.max(1, Math.min(2000, Number(q.limit) || 200))
  const offset = Math.max(0, Number(q.offset) || 0)
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
             ap.hardest_name, ap.discord_id, ap.discord_avatar,
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
        sources: ['aredl'],
        id: r.uuid,
        player: r.player,
        country: countryNumericToAlpha2(r.country),
        points: r.total_points,
        extras: { extremes: r.extremes, pack_points: r.pack_points },
        hardest: r.hardest_name,
        claimed_account: r.claimed_username ? { username: r.claimed_username, has_avatar: false } : null,
        // Straight off the row that was already read — no second lookup for the
        // source that has the answer in hand.
        aredl_avatar_url: discordAvatarUrl(r.discord_id, r.discord_avatar, 64),
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
        sources: ['pointercrate'],
        id: r.pc_id,
        player: r.player,
        country: r.nationality,
        points: r.score,
        extras: {},
        hardest: r.hardest_name,
        claimed_account: r.claimed_username ? { username: r.claimed_username, has_avatar: false } : null,
      })
    }
  }

  if (source === 'all' || source === 'gdl') {
    const params: any[] = []
    let where = `WHERE gp.is_banned = 0`
    if (search && !isCombined) {
      where += ` AND gp.username LIKE ? COLLATE NOCASE`
      params.push(`%${search}%`)
    }
    const sql = `
      SELECT gp.gdl_id, gp.username AS player, gp.country, gp.points, gp.placement,
             gp.hardest_name,
             a.username AS claimed_username
        FROM gdl_players gp
        LEFT JOIN accounts a ON a.id = gp.claimed_account_id
       ${where}
       ORDER BY gp.placement ASC, gp.username COLLATE NOCASE ASC
       ${isCombined ? '' : 'LIMIT ?'}
    `
    if (!isCombined) params.push(limit)
    const gdlRows = db.prepare(sql).all(...params) as any[]
    for (const r of gdlRows) {
      rows.push({
        rank: r.placement,
        source: 'gdl',
        sources: ['gdl'],
        id: r.gdl_id,
        player: r.player,
        country: r.country,
        points: r.points,
        extras: {},
        hardest: r.hardest_name,
        claimed_account: r.claimed_username ? { username: r.claimed_username, has_avatar: false } : null,
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
      `SELECT LOWER(r.player_name) AS k, COUNT(*) AS n
         FROM records r
         JOIN levels l ON l.id = r.level_id
        WHERE r.permanent = 1
          AND (l.difficulty = 'Extreme Demon'
               OR (l.gddl_tier IS NOT NULL
                   AND CAST(REPLACE(l.gddl_tier, 'Tier ', '') AS INTEGER) >= 20))
        GROUP BY LOWER(r.player_name)`,
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
        sources: ['alllist'],
        id: r.player,
        player: r.player,
        country: r.country,
        points: r.points,
        extras: { extremes: r.extremes },
        hardest: r.hardest,
        claimed_account: r.claimed_username ? { username: r.claimed_username, has_avatar: false } : null,
      })
    }
  }

  if (isCombined) {
    // Merge duplicates across sources: a player who shows up in AREDL + PC
    // (or any combination) collapses into ONE row with `sources` listing
    // every list they appear on. Match by case-insensitive player name —
    // there's no canonical cross-source ID.
    //
    // Routing priority (which `source` + `id` we keep): aredl > pointercrate
    // > gdl > alllist. Points always reflect the player's ALL list standing
    // (even when their primary routing source is external) so the column is
    // a uniform currency across rows. Players with no ALL list entry get 0.
    const SOURCE_RANK: Record<Source, number> = { aredl: 0, pointercrate: 1, gdl: 2, alllist: 3 }
    const allPointsMap = new Map<string, number>()
    for (const r of rows) {
      if (r.source === 'alllist') allPointsMap.set(r.player.toLowerCase(), r.points ?? 0)
    }
    const merged = new Map<string, Row>()
    for (const r of rows) {
      const key = r.player.toLowerCase()
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...r, sources: [...r.sources] })
        continue
      }
      // Pick the source with higher routing priority as the primary.
      if (SOURCE_RANK[r.source] < SOURCE_RANK[existing.source]) {
        existing.source = r.source
        existing.id = r.id
      }
      for (const s of r.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s)
      }
      existing.country = existing.country ?? r.country
      existing.hardest = existing.hardest ?? r.hardest
      existing.claimed_account = existing.claimed_account ?? r.claimed_account
      // The one row of this merge that carries a picture is the AREDL one, and
      // it is not necessarily the row that won routing — a player ranked on
      // Pointercrate too keeps whichever source came first. Carrying it across
      // is what stops the merged view being blanker than the AREDL-only view.
      existing.aredl_avatar_url = existing.aredl_avatar_url ?? r.aredl_avatar_url
      existing.extras = {
        extremes: existing.extras.extremes ?? r.extras.extremes,
        pack_points: existing.extras.pack_points ?? r.extras.pack_points,
      }
    }
    // Order sources for stable display: aredl first, pc, gdl, then alllist.
    // Points: prefer the player's ALL-list standing when known, but fall back
    // to whatever the primary source contributed when the player isn't on the
    // ALL list. The earlier behaviour zero'd these out unconditionally, which
    // made the column read "0" for every external-only player.
    for (const row of merged.values()) {
      row.sources.sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b])
      row.points = allPointsMap.get(row.player.toLowerCase()) ?? 0
    }
    const mergedRows = Array.from(merged.values())

    // Sort merged set by ALL points and assign unified ranks across all lists.
    mergedRows.sort((a, b) => {
      const dp = (b.points ?? 0) - (a.points ?? 0)
      return dp !== 0 ? dp : a.player.localeCompare(b.player, undefined, { sensitivity: 'base' })
    })
    mergedRows.forEach((r, i) => { r.rank = i + 1 })

    // Apply search AFTER ranking so the displayed rank always reflects true
    // global standing, not position within the filtered result set.
    const visible = search
      ? mergedRows.filter((r) => r.player.toLowerCase().includes(search.toLowerCase()))
      : mergedRows
    return { total: visible.length, items: attachAccountBits(db, visible.slice(offset, offset + limit)) }
  }

  return { total: rows.length, items: attachAccountBits(db, rows.slice(offset, offset + limit)) }
})

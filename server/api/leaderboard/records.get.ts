import { getDb } from '~/server/db'
import { isChallengeSql } from '~/server/utils/challenge-expr'
import { clanTagsForPlayers, type ClanBadge } from '~/server/utils/clans'
import { aredlAvatarsForPlayers } from '~/server/utils/aredl-avatars'
import { getCurrentAccount } from '~/server/utils/auth'

/**
 * All Records — every record this site knows about, from every source, scored on
 * the ALL list's own points.
 *
 * The other leaderboards each answer a narrower question. `/api/leaderboard`
 * ranks the players the sheet's leaderboard tab knew about (plus anyone with
 * records here); `/api/leaderboard/global` merges the *player standings* AREDL,
 * Pointercrate and GDL publish, each computed on that list's own scale, which is
 * why a player can sit in three places with three different point totals.
 *
 * This one goes the other way: it takes the raw records from all four sources —
 * this site, AREDL, Pointercrate, GDL — maps each to the level it was set on,
 * and scores every one of them with `levels.points`. One scale, so the totals
 * are comparable; one ranking, so a player appears exactly once.
 *
 * ## Matching a record to a level
 *
 * Site records already carry `level_id`. The imported ones carry a GD level id,
 * which is *not* unique on this list — Solo/2P and Old/Unnerfed variants share
 * one — so they are only credited when that id lands on exactly one level.
 * Guessing between variants would award the wrong level's points, and this list
 * has enough of that already.
 *
 * ## Counting a record once
 *
 * The same clear shows up in several sources: a top-50 extreme is on AREDL and
 * Pointercrate both, and may have been submitted here as well. Records are
 * therefore deduplicated on (player, level) before anything is summed, so
 * appearing on three lists is worth the same as appearing on one.
 *
 * ## Ranking
 *
 * By total points, then by record count, then by name. Count is returned
 * alongside and shown in its own column: the two orderings disagree — many easy
 * levels versus few hard ones — and points is the one the rest of the site
 * ranks by, so it leads and the other is visible next to it.
 *
 * `?mode=challenges` restricts the whole thing to challenge levels, using the
 * site's one definition of a challenge (`server/utils/challenge-expr.ts`). It is
 * the same players and the same points, narrowed — not the separate scale that
 * `/api/leaderboard/challenges` ranks on.
 */

const IS_CHALLENGE = isChallengeSql('l', 'c')

type Row = {
  player: string
  points: number
  records: number
  sources: string[]
  hardest: string | null
  hardest_position: number | null
}

const TTL_MS = 30_000
const cache = new Map<Mode, { at: number; rows: Row[] }>()
type Mode = 'all' | 'challenges'

export function invalidateRecordsLeaderboard(): void {
  cache.clear()
}

function build(db: ReturnType<typeof getDb>, mode: Mode): Row[] {
  // A GD id that lands on exactly one level is safe to credit; anything else is
  // left out rather than guessed at.
  const sql = `
    WITH gd_unique AS (
      SELECT gd_id, MIN(id) AS level_id
        FROM levels
       WHERE gd_id IS NOT NULL
       GROUP BY gd_id
      HAVING COUNT(*) = 1
    ),
    all_recs AS (
      SELECT LOWER(r.player_name) AS pkey, r.player_name AS pname,
             r.level_id AS level_id, 'site' AS src
        FROM records r
       WHERE r.permanent = 1

      UNION ALL
      SELECT LOWER(a.player_name), a.player_name, g.level_id, 'aredl'
        FROM aredl_records a
        JOIN gd_unique g ON g.gd_id = a.level_gd_id

      UNION ALL
      SELECT LOWER(p.player_name), p.player_name, g.level_id, 'pointercrate'
        FROM pointercrate_records p
        JOIN gd_unique g ON g.gd_id = p.level_gd_id
       WHERE p.progress >= 100

      UNION ALL
      SELECT LOWER(d.player_name), d.player_name, g.level_id, 'gdl'
        FROM gdl_records d
        JOIN gd_unique g ON g.gd_id = d.level_gd_id
       WHERE d.percent >= 100
    ),
    -- One row per (player, level), however many sources reported it.
    deduped AS (
      SELECT pkey, level_id,
             MIN(pname) AS pname,
             GROUP_CONCAT(DISTINCT src) AS srcs
        FROM all_recs
       GROUP BY pkey, level_id
    ),
    joined AS (
      SELECT d.pkey, d.pname, d.srcs, l.name, l.position,
             COALESCE(l.points, 0) AS points
        FROM deduped d
        JOIN levels l ON l.id = d.level_id
        LEFT JOIN gd_info_cache c ON c.gd_id = l.gd_id
       ${mode === 'challenges' ? `WHERE ${IS_CHALLENGE}` : ''}
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY pkey ORDER BY points DESC, position ASC) AS rn
        FROM joined
    )
    SELECT MIN(pname)                              AS player,
           SUM(points)                             AS points,
           COUNT(*)                                AS records,
           GROUP_CONCAT(DISTINCT srcs)             AS srcs,
           MAX(CASE WHEN rn = 1 THEN name END)     AS hardest,
           MAX(CASE WHEN rn = 1 THEN position END) AS hardest_position
      FROM ranked
     GROUP BY pkey
     ORDER BY points DESC, records DESC, player COLLATE NOCASE ASC
  `

  const rows = db.prepare(sql).all() as (Omit<Row, 'sources'> & { srcs: string | null })[]
  return rows.map((r) => ({
    player: r.player,
    points: r.points,
    records: r.records,
    // GROUP_CONCAT of GROUP_CONCATs can repeat a source; the set is the answer.
    sources: [...new Set((r.srcs ?? '').split(',').filter(Boolean))].sort(),
    hardest: r.hardest,
    hardest_position: r.hardest_position,
  }))
}

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const mode: Mode = q.mode === 'challenges' ? 'challenges' : 'all'
  const limit = Math.min(2000, Math.max(1, Number(q.limit) || 200))
  const offset = Math.max(0, Number(q.offset) || 0)
  const search = String(q.q ?? '').trim().toLowerCase()
  const followedOnly = String(q.followed ?? '') === '1'

  const db = getDb()
  const hit = cache.get(mode)
  if (!hit || Date.now() - hit.at >= TTL_MS) {
    cache.set(mode, { at: Date.now(), rows: build(db, mode) })
  }

  let filtered = cache.get(mode)!.rows
  if (followedOnly) {
    const me = getCurrentAccount(event)
    if (!me) return { total: 0, items: [], mode }
    const follows = new Set((db.prepare(
      `SELECT target_name FROM follows WHERE follower_account_id = ?`,
    ).all(me.id) as { target_name: string }[]).map((f) => f.target_name.toLowerCase()))
    filtered = filtered.filter((r) => follows.has(r.player.toLowerCase()))
  }
  if (search) filtered = filtered.filter((r) => r.player.toLowerCase().includes(search))

  const total = filtered.length
  const items = filtered.slice(offset, offset + limit).map((p, i) => ({
    rank: offset + i + 1,
    ...p,
    country: null as string | null,
    account_username: null as string | null,
    has_avatar: false,
    aredl_avatar_url: null as string | null,
    clan: null as ClanBadge | null,
  }))

  // Accounts, clans and faces for this page only — the same shape the other
  // leaderboards return, so the page renders all of them with one row template.
  const names = items.map((p) => p.player)
  if (names.length) {
    const ph = names.map(() => '?').join(',')
    const accs = db.prepare(
      `SELECT username, claimed_player, country, (avatar_blob IS NOT NULL) AS has_avatar
         FROM accounts
        WHERE banned_at IS NULL
          AND (username COLLATE NOCASE IN (${ph}) OR claimed_player COLLATE NOCASE IN (${ph}))`,
    ).all(...names, ...names) as
      { username: string; claimed_player: string | null; country: string | null; has_avatar: number }[]
    const byName = new Map<string, { username: string; has_avatar: boolean; country: string | null }>()
    for (const a of accs) {
      const entry = { username: a.username, has_avatar: !!a.has_avatar, country: a.country }
      byName.set(a.username.toLowerCase(), entry)
      if (a.claimed_player) byName.set(a.claimed_player.toLowerCase(), entry)
    }
    for (const p of items) {
      const hit2 = byName.get(p.player.toLowerCase())
      p.account_username = hit2?.username ?? null
      p.has_avatar = hit2?.has_avatar ?? false
      p.country = hit2?.country ?? null
    }

    const faceless = items.filter((p) => !p.has_avatar).map((p) => p.player)
    if (faceless.length) {
      const faces = aredlAvatarsForPlayers(db, faceless)
      if (faces.size) {
        for (const p of items) {
          if (p.has_avatar) continue
          p.aredl_avatar_url = faces.get(p.player.toLowerCase()) ?? null
        }
      }
    }

    const clans = clanTagsForPlayers(db, names)
    if (clans.size) for (const p of items) p.clan = clans.get(p.player.toLowerCase()) ?? null
  }

  return { total, items, mode }
})

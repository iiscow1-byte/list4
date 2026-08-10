import type { DatabaseSync } from 'node:sqlite'
import { isChallengeSql } from './challenge-expr'
// One rule for the tag, shared with the form that types one — see the util.
export { isValidClanTag } from '~/utils/clan-tag'

/**
 * Clans, and the numbers behind them.
 *
 * A clan has no completions of its own. Every figure on the leaderboard is the
 * sum of what its members have done, read through `clan_members` at the moment
 * you ask — so somebody joining lifts their clan's standing immediately, and
 * leaving takes it with them, without a single stored total to keep in step.
 *
 * The name a member's records are filed under is `claimed_player` when they
 * have claimed a leaderboard identity and their username otherwise, which is
 * the same rule the rest of the site uses for "who is this player".
 */

/** The name a member's records are under. */
const MEMBER_NAME_SQL = `COALESCE(a.claimed_player, a.username)`

export type ClanSummary = {
  id: number
  tag: string
  name: string
  description: string | null
  color: string | null
  icon_url: string | null
  owner_username: string | null
  members: number
  /** Distinct levels beaten by anybody in the clan. */
  levels: number
  /** Every member's completions added up — the same level twice counts twice. */
  completions: number
  /** Points, counting each level once however many members have it. */
  points: number
  /** The hardest level anybody in the clan has beaten. */
  hardest: { position: number; sheet_placement: number | null; name: string; gddl_tier: string | null } | null
}

/**
 * One query for the whole leaderboard.
 *
 * Per-clan subqueries would be four round trips per clan; this is four
 * aggregates over one join and sorts in SQL. `DISTINCT r.level_id` is what
 * makes "levels" a count of the list covered rather than of records held —
 * two members with the same completion have covered one level between them.
 */
export function clanLeaderboard(db: DatabaseSync): ClanSummary[] {
  const rows = db.prepare(`
    SELECT c.id, c.tag, c.name, c.description, c.color, c.icon_url,
           o.username AS owner_username,
           COUNT(DISTINCT m.account_id) AS members,
           COUNT(DISTINCT r.level_id)   AS levels,
           COUNT(r.id)                  AS completions,
           COALESCE((
             SELECT SUM(l2.points) FROM levels l2
              WHERE l2.id IN (
                SELECT DISTINCT r2.level_id
                  FROM clan_members m2
                  JOIN accounts a2 ON a2.id = m2.account_id
                  JOIN records  r2 ON r2.player_name = COALESCE(a2.claimed_player, a2.username) COLLATE NOCASE
                 WHERE m2.clan_id = c.id AND r2.permanent = 1
              )
           ), 0) AS points
      FROM clans c
      LEFT JOIN accounts o ON o.id = c.owner_account_id
      LEFT JOIN clan_members m ON m.clan_id = c.id
      LEFT JOIN accounts a ON a.id = m.account_id
      LEFT JOIN records  r ON r.player_name = ${MEMBER_NAME_SQL} COLLATE NOCASE AND r.permanent = 1
     GROUP BY c.id
     ORDER BY points DESC, levels DESC, members DESC, c.name COLLATE NOCASE ASC
  `).all() as Omit<ClanSummary, 'hardest'>[]

  // The hardest level per clan, one query for all of them rather than one each.
  const hardest = new Map<number, ClanSummary['hardest']>()
  for (const r of db.prepare(`
    SELECT m.clan_id, l.position, l.sheet_placement, l.name, l.gddl_tier
      FROM clan_members m
      JOIN accounts a ON a.id = m.account_id
      JOIN records  r ON r.player_name = ${MEMBER_NAME_SQL} COLLATE NOCASE AND r.permanent = 1
      JOIN levels   l ON l.id = r.level_id
     GROUP BY m.clan_id
     HAVING l.position = MIN(l.position)
  `).all() as { clan_id: number; position: number; sheet_placement: number | null; name: string; gddl_tier: string | null }[]) {
    hardest.set(r.clan_id, {
      position: r.position, sheet_placement: r.sheet_placement, name: r.name, gddl_tier: r.gddl_tier,
    })
  }

  return rows.map((c) => ({ ...c, hardest: hardest.get(c.id) ?? null }))
}

export type ClanMember = {
  account_id: number
  username: string
  role: string
  has_avatar: boolean
  country: string | null
  player_name: string
  completions: number
  points: number
  joined_at: string
}

/** Everyone in a clan, ranked by what they contribute to it. */
export function clanMembers(db: DatabaseSync, clanId: number): ClanMember[] {
  return db.prepare(`
    SELECT a.id AS account_id, a.username, m.role, m.joined_at, a.country,
           (a.avatar_blob IS NOT NULL) AS has_avatar,
           ${MEMBER_NAME_SQL} AS player_name,
           COUNT(r.id) AS completions,
           COALESCE(SUM(l.points), 0) AS points
      FROM clan_members m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN records r ON r.player_name = ${MEMBER_NAME_SQL} COLLATE NOCASE AND r.permanent = 1
      LEFT JOIN levels  l ON l.id = r.level_id
     WHERE m.clan_id = ?
     GROUP BY a.id
     ORDER BY points DESC, completions DESC, a.username COLLATE NOCASE ASC
  `).all(clanId).map((r: any) => ({ ...r, has_avatar: !!r.has_avatar })) as ClanMember[]
}

/**
 * What the clan has beaten, hardest first, with who in it has done so.
 *
 * One row per *level*, not per record: a level three members have beaten is one
 * line of the clan's list with three names on it, which is what a clan's list
 * of completions means. `group_concat` keeps that to one query.
 */
export function clanCompletions(db: DatabaseSync, clanId: number, limit = 200) {
  return db.prepare(`
    SELECT l.position, l.sheet_placement, l.name, l.gd_id, l.gddl_tier, l.points,
           COUNT(DISTINCT a.id) AS beaten_by,
           GROUP_CONCAT(DISTINCT a.username) AS members,
           MAX(${isChallengeSql('l', 'ch')}) AS is_challenge
      FROM clan_members m
      JOIN accounts a ON a.id = m.account_id
      JOIN records  r ON r.player_name = ${MEMBER_NAME_SQL} COLLATE NOCASE AND r.permanent = 1
      JOIN levels   l ON l.id = r.level_id
      LEFT JOIN gd_info_cache ch ON ch.gd_id = l.gd_id
     WHERE m.clan_id = ?
     GROUP BY l.id
     ORDER BY l.position ASC
     LIMIT ?
  `).all(clanId, limit) as {
    position: number; sheet_placement: number | null; name: string; gd_id: number | null
    gddl_tier: string | null; points: number | null; beaten_by: number; members: string
    is_challenge: number
  }[]
}

/** The clan an account belongs to, if any. */
export function clanForAccount(db: DatabaseSync, accountId: number) {
  return db.prepare(`
    SELECT c.id, c.tag, c.name, c.color, m.role
      FROM clan_members m JOIN clans c ON c.id = m.clan_id
     WHERE m.account_id = ?
  `).get(accountId) as { id: number; tag: string; name: string; color: string | null; role: string } | undefined
}

/** Just enough of a clan to print its tag beside a name. */
export type ClanBadge = { tag: string; name: string; color: string | null }

/**
 * The clan behind each of these player names, in one query.
 *
 * The tag belongs next to a name wherever a name appears — leaderboard rows, a
 * level's records, a comment — and the alternative is a lookup per row, which
 * on a 200-row leaderboard page is 200 round trips to print a handful of tags.
 *
 * Names are matched the way the rest of the site matches them: against
 * `claimed_player` when the account has claimed a leaderboard identity, and
 * against the username otherwise. The map is keyed lowercase because the
 * callers hold display names, and `COLLATE NOCASE` inside SQLite does not make
 * a JavaScript `Map` case-insensitive.
 *
 * Chunked at 400 placeholders. SQLite's default host-parameter ceiling is 999,
 * and the leaderboard will hand this up to 2,000 names.
 */
export function clanTagsForPlayers(db: DatabaseSync, names: string[]): Map<string, ClanBadge> {
  const out = new Map<string, ClanBadge>()
  const unique = [...new Set(names.filter(Boolean).map((n) => n.toLowerCase()))]
  if (!unique.length) return out

  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400)
    const ph = chunk.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT ${MEMBER_NAME_SQL} AS player_name, c.tag, c.name, c.color
        FROM clan_members m
        JOIN accounts a ON a.id = m.account_id
        JOIN clans    c ON c.id = m.clan_id
       WHERE a.banned_at IS NULL
         AND ${MEMBER_NAME_SQL} COLLATE NOCASE IN (${ph})
    `).all(...chunk) as { player_name: string; tag: string; name: string; color: string | null }[]
    for (const r of rows) {
      out.set(r.player_name.toLowerCase(), { tag: r.tag, name: r.name, color: r.color })
    }
  }
  return out
}

/**
 * Attach `clan` to every row that has a player name on it.
 *
 * Written once rather than at each call site because "which column holds the
 * name" is the only thing that differs between the leaderboard, a level's
 * records and a follow list — and getting that wrong shows up as tags silently
 * missing rather than as an error.
 */
export function attachClans<T extends Record<string, any>>(
  db: DatabaseSync,
  rows: T[],
  nameKey: keyof T & string,
): (T & { clan: ClanBadge | null })[] {
  const tags = clanTagsForPlayers(db, rows.map((r) => String(r[nameKey] ?? '')))
  return rows.map((r) => ({
    ...r,
    clan: tags.get(String(r[nameKey] ?? '').toLowerCase()) ?? null,
  }))
}


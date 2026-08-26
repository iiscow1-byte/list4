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
  /** An uploaded icon exists — see `utils/clan-images.ts` for which one wins. */
  has_icon: boolean
  banner_url: string | null
  has_banner: boolean
  invite_only: number
  created_at: string
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
  /**
   * The clan's difficulty, as a tier.
   *
   * A points-weighted average of everything the clan has cleared, mapped back
   * to the tier of the level worth closest to that number. `tier_points` is the
   * raw average behind it, which is what the leaderboard actually sorts on —
   * tier names are coarse, and two clans deep in Tier 38 should not be tied.
   */
  tier: string | null
  tier_points: number
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
    SELECT c.id, c.tag, c.name, c.description, c.color, c.icon_url, c.banner_url,
           c.invite_only, c.created_at,
           (c.icon_blob   IS NOT NULL) AS has_icon,
           (c.banner_blob IS NOT NULL) AS has_banner,
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
           ), 0) AS points,
           /**
            * A points-weighted average, not a plain one.
            *
            * Each level counts in proportion to what it is worth, so the sum is
            * Σ(p²)/Σ(p) rather than Σ(p)/n. A plain mean is unusable here: most
            * of the list is worth nothing — thousands of levels sit at zero
            * points — so a clan that had beaten the hardest level in the game
            * and five hundred easy ones averaged out somewhere around Tier 26.
            * Beating easy levels should never cost a clan standing, and under
            * this it cannot: a zero-point level contributes nothing to either
            * sum, and an easy one moves the result by a fraction of a percent.
            *
            * Weight is the points themselves. Using a lower power instead --
            * SUM(p * SQRT(p)) over SUM(SQRT(p)) -- spreads clans out more and
            * leans less on the single hardest clear, if this ever reads as too
            * top-heavy.
            */
           COALESCE((
             SELECT SUM(l3.points * l3.points) / NULLIF(SUM(l3.points), 0) FROM levels l3
              WHERE l3.points IS NOT NULL AND l3.id IN (
                SELECT DISTINCT r3.level_id
                  FROM clan_members m3
                  JOIN accounts a3 ON a3.id = m3.account_id
                  JOIN records  r3 ON r3.player_name = COALESCE(a3.claimed_player, a3.username) COLLATE NOCASE
                 WHERE m3.clan_id = c.id AND r3.permanent = 1
              )
           ), 0) AS tier_points
      FROM clans c
      LEFT JOIN accounts o ON o.id = c.owner_account_id
      LEFT JOIN clan_members m ON m.clan_id = c.id
      LEFT JOIN accounts a ON a.id = m.account_id
      LEFT JOIN records  r ON r.player_name = ${MEMBER_NAME_SQL} COLLATE NOCASE AND r.permanent = 1
     GROUP BY c.id
     ORDER BY tier_points DESC, points DESC, levels DESC, members DESC, c.name COLLATE NOCASE ASC
  `).all() as Omit<ClanSummary, 'hardest' | 'tier'>[]

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

  const toTier = tierForPoints(db)

  return rows.map((c: any) => ({
    ...c,
    has_icon: !!c.has_icon,
    has_banner: !!c.has_banner,
    hardest: hardest.get(c.id) ?? null,
    tier_points: c.tier_points ?? 0,
    tier: c.levels > 0 ? toTier(c.tier_points ?? 0) : null,
  })) as ClanSummary[]
}

/**
 * Turn a points figure into the tier of the level worth closest to it.
 *
 * Built once per call and closed over, because the alternative — an
 * `ORDER BY ABS(points - ?)` per clan — is a scan of fifty-four thousand rows
 * each time. There are only about 5,600 distinct point values on the whole
 * list, so one sorted copy answers every clan by binary search.
 *
 * Two things are tie-broken here, and they break opposite ways:
 *
 * Equal *points across different tiers* resolve to the easiest of them. Most of
 * the list is worth zero, so "0 points" alone names dozens of tiers; a clan
 * whose only clears are free levels is at the bottom of the list, and saying
 * Subtier 3 because that row happened to sort first would be inventing a
 * standing it has not got.
 *
 * A target sitting *between* two different point values goes to the harder one.
 * That is genuinely arbitrary, and rounding a clan up is the kinder half of it.
 */
function tierForPoints(db: DatabaseSync): (points: number) => string | null {
  const table = db.prepare(`
    SELECT DISTINCT points, gddl_tier FROM levels
     WHERE points IS NOT NULL AND gddl_tier IS NOT NULL
     ORDER BY points ASC,
       CASE
         WHEN gddl_tier LIKE 'Subtier %' THEN CAST(SUBSTR(gddl_tier, 9) AS INTEGER)
         WHEN gddl_tier LIKE 'Tier %'    THEN 5 + CAST(SUBSTR(gddl_tier, 6) AS INTEGER)
         ELSE 999
       END ASC
  `).all() as { points: number; gddl_tier: string }[]

  return (target: number): string | null => {
    if (!table.length) return null
    let lo = 0
    let hi = table.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (table[mid]!.points < target) lo = mid + 1
      else hi = mid
    }
    // `lo` is the first entry at or above the target. Because equal points are
    // ordered easiest-tier-first, an exact hit lands on the easiest tier worth
    // that many points, which is the answer for the many levels worth zero.
    const above = table[lo]!
    const below = table[lo - 1]
    if (!below) return above.gddl_tier
    return (target - below.points) < (above.points - target) ? below.gddl_tier : above.gddl_tier
  }
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

/**
 * Every clan that has asked this account in.
 *
 * Plural on purpose: an account can hold invites from several clans at once,
 * and being in one already doesn't retract the others — somebody can leave and
 * take an older invite up. Ordered newest first, since the most recent ask is
 * the one being thought about.
 */
export function invitesForAccount(db: DatabaseSync, accountId: number) {
  return db.prepare(`
    SELECT c.id, c.tag, c.name, c.color, c.icon_url,
           i.message, i.created_at,
           inv.username AS invited_by_username
      FROM clan_invites i
      JOIN clans c ON c.id = i.clan_id
      LEFT JOIN accounts inv ON inv.id = i.invited_by
     WHERE i.account_id = ?
     ORDER BY i.created_at DESC
  `).all(accountId) as {
    id: number; tag: string; name: string; color: string | null; icon_url: string | null
    message: string | null; created_at: string; invited_by_username: string | null
  }[]
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


import type { DatabaseSync } from 'node:sqlite'

/**
 * Scoring + leaderboard for custom lists running as full list sites.
 *
 * Points decay exponentially with rank, the shape every pointercrate-style
 * list uses: the #1 level is worth `max_points`, the last scored level is
 * worth `min_points`, and everything between follows a smooth curve. Because
 * the curve is anchored to the list's own length, a 12-level list and a
 * 400-level list both spread their points across the same range instead of
 * one of them bunching up at the bottom.
 *
 *   points(rank) = max * (min / max) ^ ((rank - 1) / (scored - 1))
 *
 * Levels past `scored_count` (when set) are worth nothing — the "legacy"
 * tail that lists keep around for history.
 *
 * A record at 100% earns the level's full value. A qualifying partial earns
 * that value scaled by how far it got, so chasing progress on a hard level
 * still shows up without ever beating an actual completion.
 */
export type ListScoreSettings = {
  max_points: number
  min_points: number
  /** 0 = every level scores. */
  scored_count: number
}

export function pointsForRank(rank: number, totalItems: number, s: ListScoreSettings): number {
  if (!Number.isInteger(rank) || rank < 1) return 0
  const scored = s.scored_count > 0 ? Math.min(s.scored_count, totalItems) : totalItems
  if (rank > scored) return 0
  if (scored <= 1) return round2(s.max_points)

  const max = Math.max(0, s.max_points)
  const min = Math.max(0, Math.min(s.min_points, max))
  // A zero floor would make the ratio undefined, so fall back to a linear ramp.
  if (min === 0) return round2(max * (1 - (rank - 1) / (scored - 1)))

  return round2(max * Math.pow(min / max, (rank - 1) / (scored - 1)))
}

/** Points a record is worth: full value at 100%, scaled for a partial. */
export function pointsForRecord(levelPoints: number, percent: number): number {
  if (percent >= 100) return round2(levelPoints)
  return round2(levelPoints * (Math.max(0, Math.min(100, percent)) / 100))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type LeaderboardRow = {
  rank: number
  player_name: string
  points: number
  completions: number
  progresses: number
  hardest_name: string | null
  hardest_rank: number | null
  /** Level art for the hardest completion, shown behind podium cards. */
  hardest_gd_id: number | null
  account_username: string | null
  has_avatar: boolean
  /**
   * GDSR lists only — how far this player is through the list and its tiers.
   *
   * A GDSR is not ranked, so points mean nothing on one: what a player has is a
   * count of levels cleared out of the clearable total, and the set of tiers
   * that count has earned them.
   */
  cleared?: number
  clearable?: number
  tiers_earned?: string[]
}

/** A GDSR tier: its levels, and how many of them earn it. */
type GdsrTier = { name: string; itemIds: Set<number>; require: number | null }

/**
 * Rank every player holding an approved record on the list. Points come from
 * each record's level rank, so moving a level reshuffles the leaderboard the
 * next time it's read — no denormalised totals to keep in sync.
 */
export function buildLeaderboard(db: DatabaseSync, listId: number): LeaderboardRow[] {
  const settings = db.prepare(
    `SELECT max_points, min_points, scored_count, follow_all_order, kind FROM custom_lists WHERE id = ?`,
  ).get(listId) as (ListScoreSettings & { follow_all_order: number; kind: string }) | undefined
  if (!settings) return []
  const isGdsr = settings.kind === 'gdsr'

  /**
   * GDSR tiers, and the levels that can actually be cleared.
   *
   * An unverified level has never been beaten by anyone, so counting it in the
   * denominator would cap every player below 100% on a list that is complete as
   * far as anyone can play it — and would make a tier requirement unreachable
   * if enough of its levels were drafts.
   */
  const gdsrTiers: GdsrTier[] = []
  const unclearable = new Set<number>()
  if (isGdsr) {
    for (const r of db.prepare(
      `SELECT id FROM custom_list_items WHERE list_id = ? AND unverified = 1`,
    ).all(listId) as { id: number }[]) unclearable.add(r.id)

    const packs = db.prepare(
      `SELECT id, name, require_count FROM custom_list_packs WHERE list_id = ? ORDER BY sort_order ASC, id ASC`,
    ).all(listId) as { id: number; name: string; require_count: number | null }[]
    for (const p of packs) {
      const ids = (db.prepare(
        `SELECT item_id FROM custom_list_pack_items WHERE pack_id = ?`,
      ).all(p.id) as { item_id: number }[])
        .map((r) => r.item_id)
        .filter((id) => !unclearable.has(id))
      gdsrTiers.push({ name: p.name, itemIds: new Set(ids), require: p.require_count })
    }
  }

  /**
   * Rank per item, in whatever order the list actually presents.
   *
   * A list set to follow the ALL's placements is ordered by those rather than
   * by `sort_order`, and points come from rank — deriving rank from
   * `sort_order` here would quietly score everyone against a different list
   * from the one they can see.
   */
  const ordered = db.prepare(
    `SELECT i.id, i.sort_order, l.position
       FROM custom_list_items i
       LEFT JOIN levels l ON l.id = i.level_id
      WHERE i.list_id = ?`,
  ).all(listId) as { id: number; sort_order: number; position: number | null }[]
  if (ordered.length === 0) return []

  ordered.sort((a, b) => {
    if (settings.follow_all_order) {
      if (a.position == null && b.position == null) return a.sort_order - b.sort_order
      if (a.position == null) return 1
      if (b.position == null) return -1
      return a.position - b.position
    }
    return a.sort_order - b.sort_order
  })
  const rankOf = new Map(ordered.map((r, i) => [r.id, i + 1]))
  const totalItems = ordered.length

  const rows = db.prepare(
    `SELECT r.player_name, r.percent, i.id AS item_id,
            COALESCE(i.ov_name, i.name) AS level_name, i.gd_id AS level_gd_id
       FROM custom_list_records r
       JOIN custom_list_items i ON i.id = r.item_id
      WHERE r.list_id = ? AND r.status = 'approved'`,
  ).all(listId) as {
    player_name: string
    percent: number
    item_id: number
    level_name: string
    level_gd_id: number | null
  }[]

  type Acc = Omit<LeaderboardRow, 'rank'>
  const byPlayer = new Map<string, Acc>()
  /** Items each player has a 100% record on — the input to tier progress. */
  const clearedItems = new Map<string, Set<number>>()

  for (const r of rows) {
    const rank = rankOf.get(r.item_id)
    if (rank == null) continue // record whose level left the list mid-read
    const levelPoints = pointsForRank(rank, totalItems, settings)
    const earned = pointsForRecord(levelPoints, r.percent)
    const key = r.player_name.toLowerCase()

    let acc = byPlayer.get(key)
    if (!acc) {
      acc = {
        player_name: r.player_name,
        points: 0,
        completions: 0,
        progresses: 0,
        hardest_name: null,
        hardest_rank: null,
        hardest_gd_id: null,
        account_username: null,
        has_avatar: false,
        ...(isGdsr ? { cleared: 0, clearable: 0, tiers_earned: [] as string[] } : {}),
      }
      byPlayer.set(key, acc)
    }
    acc.points = Math.round((acc.points + earned) * 100) / 100
    if (r.percent >= 100) {
      acc.completions++
      // An unverified level cannot have been cleared; if a record exists for
      // one it predates the flag, and the flag is the editors' current word.
      if (!unclearable.has(r.item_id)) {
        let set = clearedItems.get(key)
        if (!set) { set = new Set<number>(); clearedItems.set(key, set) }
        set.add(r.item_id)
      }
    } else acc.progresses++
    // "Hardest" = the best-placed level they've actually completed.
    if (r.percent >= 100 && (acc.hardest_rank === null || rank < acc.hardest_rank)) {
      acc.hardest_rank = rank
      acc.hardest_name = r.level_name
      acc.hardest_gd_id = r.level_gd_id
    }
  }

  /**
   * The site account behind each name, resolved from the name itself.
   *
   * This used to come from a join on `submitted_by`, which is whoever *entered*
   * the record — so a list where an editor adds everyone's records gave every
   * player that editor's username and picture. The player's identity is their
   * name: an account owns it by being called that, or by having claimed it.
   */
  const names = Array.from(byPlayer.values(), (a) => a.player_name)
  if (names.length) {
    const ph = names.map(() => '?').join(',')
    const accounts = db.prepare(
      `SELECT username, claimed_player, (avatar_blob IS NOT NULL) AS has_avatar
         FROM accounts
        WHERE banned_at IS NULL
          AND (username COLLATE NOCASE IN (${ph}) OR claimed_player COLLATE NOCASE IN (${ph}))`,
    ).all(...names, ...names) as
      { username: string; claimed_player: string | null; has_avatar: number }[]

    const byName = new Map<string, { username: string; has_avatar: boolean }>()
    for (const a of accounts) {
      const entry = { username: a.username, has_avatar: !!a.has_avatar }
      // A claim is the stronger statement — "this leaderboard name is me" —
      // so it wins over an account that merely happens to share the spelling.
      if (a.claimed_player) byName.set(a.claimed_player.toLowerCase(), entry)
      if (!byName.has(a.username.toLowerCase())) byName.set(a.username.toLowerCase(), entry)
    }
    for (const acc of byPlayer.values()) {
      const hit = byName.get(acc.player_name.toLowerCase())
      if (!hit) continue
      acc.account_username = hit.username
      acc.has_avatar = hit.has_avatar
    }
  }

  if (isGdsr) {
    const clearable = ordered.filter((o) => !unclearable.has(o.id)).length
    for (const [key, acc] of byPlayer) {
      const mine = clearedItems.get(key) ?? new Set<number>()
      acc.cleared = mine.size
      acc.clearable = clearable
      acc.tiers_earned = gdsrTiers
        .filter((t) => {
          if (t.itemIds.size === 0) return false
          let hit = 0
          for (const id of t.itemIds) if (mine.has(id)) hit++
          // No requirement means the tier asks for all of its levels.
          const need = t.require == null ? t.itemIds.size : Math.min(t.require, t.itemIds.size)
          return hit >= need
        })
        .map((t) => t.name)
    }

    // A GDSR is not ranked, so points are meaningless on one: standing is how
    // many levels you have cleared, then how many tiers that earned.
    return Array.from(byPlayer.values())
      .sort((a, b) =>
        (b.cleared ?? 0) - (a.cleared ?? 0)
        || (b.tiers_earned?.length ?? 0) - (a.tiers_earned?.length ?? 0)
        || a.player_name.localeCompare(b.player_name))
      .map((row, i) => ({ rank: i + 1, ...row }))
  }

  return Array.from(byPlayer.values())
    .sort((a, b) => b.points - a.points || b.completions - a.completions
      || a.player_name.localeCompare(b.player_name))
    .map((row, i) => ({ rank: i + 1, ...row }))
}

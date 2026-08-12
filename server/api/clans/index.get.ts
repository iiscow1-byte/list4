import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { clanForAccount, clanLeaderboard, invitesForAccount, type ClanSummary } from '~/server/utils/clans'

/**
 * Every clan, ranked — and browsable.
 *
 * The page was a leaderboard and only a leaderboard: one ordering, points
 * descending, and no way to answer "which clans could I actually join" or
 * "who started one recently". A clan you can't find is a clan you can't join,
 * and the top of a points ranking is exactly where a new clan isn't.
 *
 * So the sort is a parameter and there are two filters. All of it happens here
 * rather than in the browser because `clanLeaderboard` already builds the whole
 * set — it is one query over every clan — and sorting a few hundred rows on the
 * server costs nothing while sending them all and sorting per keystroke costs
 * a re-render each time.
 *
 * `mine`, `invites` and `signedIn` are unchanged: they are what lets the page
 * offer "leave" instead of "join", and show an invite to somebody who would
 * otherwise have to already know about it.
 */
export type ClanSort = 'points' | 'levels' | 'members' | 'newest' | 'name'

const SORTS: Record<ClanSort, (a: ClanSummary, b: ClanSummary) => number> = {
  points:  (a, b) => b.points - a.points || b.levels - a.levels || a.name.localeCompare(b.name),
  levels:  (a, b) => b.levels - a.levels || b.points - a.points || a.name.localeCompare(b.name),
  members: (a, b) => b.members - a.members || b.points - a.points || a.name.localeCompare(b.name),
  // `created_at` is an ISO-ish string from SQLite, so it sorts lexically.
  newest:  (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || a.name.localeCompare(b.name),
  name:    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
}

export default defineEventHandler((event) => {
  const db = getDb()
  const me = getCurrentAccount(event)
  const q = getQuery(event)

  const sort = (typeof q.sort === 'string' && q.sort in SORTS ? q.sort : 'points') as ClanSort
  const search = String(q.q ?? '').trim().toLowerCase()
  /** 'open' hides clans you'd have to ask to join; 'invite' shows only those. */
  const joinable = q.joinable === 'open' || q.joinable === 'invite' ? q.joinable : null

  let clans = clanLeaderboard(db)

  /**
   * Rank is assigned before filtering, and always by points.
   *
   * A clan's rank is its standing among every clan; showing "#1" against the
   * top result of a name search would be inventing a fact. Sorting by something
   * else doesn't change it either — the number means "1st by points" wherever
   * it is printed.
   */
  const ranked = [...clans].sort(SORTS.points)
  const rankById = new Map(ranked.map((c, i) => [c.id, i + 1]))

  if (search) {
    clans = clans.filter(
      (c) => c.name.toLowerCase().includes(search) || c.tag.toLowerCase().includes(search),
    )
  }
  if (joinable === 'open') clans = clans.filter((c) => !c.invite_only)
  else if (joinable === 'invite') clans = clans.filter((c) => !!c.invite_only)

  clans = [...clans].sort(SORTS[sort])

  return {
    clans: clans.map((c) => ({ ...c, rank: rankById.get(c.id) ?? null })),
    total: ranked.length,
    sort,
    mine: me ? clanForAccount(db, me.id) ?? null : null,
    invites: me ? invitesForAccount(db, me.id) : [],
    signedIn: !!me,
  }
})

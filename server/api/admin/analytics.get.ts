import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { pruneVisitUniques } from '~/server/utils/analytics'

/**
 * What the site's traffic and its growth look like.
 *
 * Everything here is an aggregate read off the counting tables and the
 * `created_at` columns the site already keeps — no new bookkeeping, and nothing
 * that identifies a reader. Two questions, answered side by side because they
 * only mean something together: how much is the site being read, and how much
 * is being added to it.
 *
 * One request rather than six, because the tab draws them on one screen and
 * six round trips to draw one screen is the thing that makes a dashboard feel
 * slow.
 */

/** Rows for `days` days ending today, with zeroes where nothing happened. */
function fillDays(rows: { day: string; n: number }[], days: number): { day: string; n: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.n]))
  const out: { day: string; n: number }[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key, n: byDay.get(key) ?? 0 })
  }
  return out
}

export default defineEventHandler((event) => {
  requireMod(event)
  const q = getQuery(event)
  const days = Math.max(7, Math.min(365, Number(q.days) || 30))
  const db = getDb()

  // Housekeeping, here rather than on a timer: this is the one place that reads
  // the table, so it is the one place that notices it has grown a stale year.
  pruneVisitUniques()

  const since = `-${days - 1} days`

  const viewsPerDay = db.prepare(
    `SELECT day, SUM(views) AS n FROM page_views
      WHERE day >= date('now', ?) GROUP BY day ORDER BY day`,
  ).all(since) as { day: string; n: number }[]

  const uniquesPerDay = db.prepare(
    `SELECT day, COUNT(*) AS n FROM visit_uniques
      WHERE day >= date('now', ?) GROUP BY day ORDER BY day`,
  ).all(since) as { day: string; n: number }[]

  const totals = {
    viewsAllTime: (db.prepare(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views`).get() as { n: number }).n,
    viewsToday: (db.prepare(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE day = date('now')`).get() as { n: number }).n,
    views7: (db.prepare(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE day >= date('now', '-6 days')`).get() as { n: number }).n,
    views30: (db.prepare(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE day >= date('now', '-29 days')`).get() as { n: number }).n,
    visitorsToday: (db.prepare(`SELECT COUNT(*) AS n FROM visit_uniques WHERE day = date('now')`).get() as { n: number }).n,
    visitors7: (db.prepare(`SELECT COUNT(DISTINCT visitor) AS n FROM visit_uniques WHERE day >= date('now', '-6 days')`).get() as { n: number }).n,
    visitors30: (db.prepare(`SELECT COUNT(DISTINCT visitor) AS n FROM visit_uniques WHERE day >= date('now', '-29 days')`).get() as { n: number }).n,
    /** Days with any traffic at all — says how long this has been counting. */
    countingSince: (db.prepare(`SELECT MIN(day) AS d FROM page_views`).get() as { d: string | null }).d,
  }

  const topPages = db.prepare(
    `SELECT path, SUM(views) AS n FROM page_views
      WHERE day >= date('now', ?) GROUP BY path ORDER BY n DESC LIMIT 15`,
  ).all(since) as { path: string; n: number }[]

  const topLevels = db.prepare(
    `SELECT l.position, l.sheet_placement, l.name, v.views AS n, v.last_viewed_at
       FROM level_views v JOIN levels l ON l.id = v.level_id
      ORDER BY v.views DESC LIMIT 15`,
  ).all() as { position: number; sheet_placement: number | null; name: string; n: number; last_viewed_at: string }[]

  /**
   * What the site gained, per day, from the tables that already record when.
   *
   * Each one is a different kind of contribution — someone joined, someone
   * offered a level, someone proved a completion, someone built a list — and
   * they are worth reading against the traffic beside them.
   */
  const series = (sql: string) =>
    fillDays(db.prepare(sql).all(since) as { day: string; n: number }[], days)

  const growth = {
    accounts: series(
      `SELECT DATE(created_at) AS day, COUNT(*) AS n FROM accounts
        WHERE created_at >= date('now', ?) GROUP BY day`),
    levelsSubmitted: series(
      `SELECT DATE(submitted_at) AS day, COUNT(*) AS n FROM pending_levels
        WHERE submitted_at >= date('now', ?) GROUP BY day`),
    records: series(
      `SELECT DATE(submitted_at) AS day, COUNT(*) AS n FROM records
        WHERE submitted_at >= date('now', ?) GROUP BY day`),
    customLists: series(
      `SELECT DATE(created_at) AS day, COUNT(*) AS n FROM custom_lists
        WHERE created_at >= date('now', ?) GROUP BY day`),
    comments: series(
      `SELECT DATE(created_at) AS day, COUNT(*) AS n FROM comments
        WHERE created_at >= date('now', ?) GROUP BY day`),
    opinions: series(
      `SELECT DATE(submitted_at) AS day, COUNT(*) AS n FROM opinions
        WHERE submitted_at >= date('now', ?) GROUP BY day`),
  }

  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  const lifetime = {
    accounts: one(`SELECT COUNT(*) AS n FROM accounts`),
    accountsWithRecords: one(`SELECT COUNT(DISTINCT a.id) AS n FROM accounts a
       JOIN records r ON r.player_name = COALESCE(a.claimed_player, a.username) COLLATE NOCASE`),
    levels: one(`SELECT COUNT(*) AS n FROM levels`),
    levelsSubmitted: one(`SELECT COUNT(*) AS n FROM pending_levels`),
    levelsPending: one(`SELECT COUNT(*) AS n FROM pending_levels WHERE status = 'pending'`),
    records: one(`SELECT COUNT(*) AS n FROM records`),
    recordsPending: one(`SELECT COUNT(*) AS n FROM records WHERE permanent = 0`),
    customLists: one(`SELECT COUNT(*) AS n FROM custom_lists`),
    publicLists: one(`SELECT COUNT(*) AS n FROM custom_lists WHERE is_public = 1`),
    comments: one(`SELECT COUNT(*) AS n FROM comments`),
    opinions: one(`SELECT COUNT(*) AS n FROM opinions`),
    progressPosts: one(`SELECT COUNT(*) AS n FROM progress_posts`),
    follows: one(`SELECT COUNT(*) AS n FROM follows`),
    levelsViewed: one(`SELECT COUNT(*) AS n FROM level_views`),
  }

  return {
    days,
    totals,
    lifetime,
    traffic: {
      views: fillDays(viewsPerDay, days),
      visitors: fillDays(uniquesPerDay, days),
    },
    topPages,
    topLevels,
    growth,
  }
})

import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { pruneAnalytics } from '~/server/utils/analytics'
import { importedPendingSql, submittedPendingSql } from '~/server/utils/pending-source'

/**
 * What the site's traffic and its growth look like.
 *
 * Everything here is an aggregate read off the counting tables and the
 * `created_at` columns the site already keeps — no new bookkeeping, and nothing
 * that identifies a reader. Two questions, answered side by side because they
 * only mean something together: how much is the site being read, and how much
 * is being added to it.
 *
 * One request rather than a dozen, because the tab draws them on one screen and
 * a dozen round trips to draw one screen is what makes a dashboard feel slow.
 *
 * ## Views and visitors are different numbers
 *
 * They are kept apart everywhere, and each series carries both, because the
 * ratio between them is the interesting part: four thousand views from two
 * hundred people is a site being read, and four thousand from six is a script.
 * A single "traffic" figure hides exactly that.
 *
 * ## Every window means the same thing
 *
 * `days` selects a window ending *today, inclusive*, and every series, every
 * top-list and every total in `range` uses that same window. The most-viewed
 * levels used to be all-time while the pages beside them were the last thirty
 * days, which is two different questions under one heading.
 */

/** Rows for `days` days ending today, with zeroes where nothing happened. */
function fillDays<T extends Record<string, number>>(
  rows: ({ day: string } & Partial<T>)[],
  days: number,
  keys: (keyof T)[],
): ({ day: string } & T)[] {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const out: ({ day: string } & T)[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    const hit = byDay.get(key)
    const point = { day: key } as { day: string } & T
    for (const k of keys) point[k] = ((hit?.[k] as number | undefined) ?? 0) as T[keyof T]
    out.push(point)
  }
  return out
}

export default defineEventHandler((event) => {
  requireMod(event)
  const q = getQuery(event)
  const days = Math.max(7, Math.min(365, Number(q.days) || 30))
  const db = getDb()

  // Housekeeping, here rather than on a timer: this is the one place that reads
  // these tables, so it is the one place that notices they have grown a stale
  // year.
  pruneAnalytics()

  // `days` counts today, so the window opens `days - 1` days ago.
  const since = `-${days - 1} days`

  const rows = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params as any[]) as T[]
  const one = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params as any[]) as { n: number } | undefined)?.n ?? 0

  // ---------------------------------------------------------------- traffic
  const viewsPerDay = rows<{ day: string; views: number }>(
    `SELECT day, SUM(views) AS views FROM page_views
      WHERE day >= date('now', ?) GROUP BY day`, since)
  const visitorsPerDay = rows<{ day: string; visitors: number }>(
    `SELECT day, COUNT(*) AS visitors FROM visit_uniques
      WHERE day >= date('now', ?) GROUP BY day`, since)
  const accountsPerDay = rows<{ day: string; accounts: number; logins: number }>(
    `SELECT day, COUNT(*) AS accounts, COALESCE(SUM(logins), 0) AS logins
       FROM account_days WHERE day >= date('now', ?) GROUP BY day`, since)

  /**
   * One row per day carrying every series, rather than four arrays the client
   * has to line up by index. Lining them up by index is exactly the kind of
   * thing that silently mis-labels a chart the day one series is missing a row.
   */
  const merged = new Map<string, { day: string; views: number; visitors: number; accounts: number; logins: number }>()
  const at = (day: string) => {
    let row = merged.get(day)
    if (!row) { row = { day, views: 0, visitors: 0, accounts: 0, logins: 0 }; merged.set(day, row) }
    return row
  }
  for (const r of viewsPerDay) at(r.day).views = r.views
  for (const r of visitorsPerDay) at(r.day).visitors = r.visitors
  for (const r of accountsPerDay) { at(r.day).accounts = r.accounts; at(r.day).logins = r.logins }

  const daily = fillDays<{ views: number; visitors: number; accounts: number; logins: number }>(
    [...merged.values()], days, ['views', 'visitors', 'accounts', 'logins'],
  )

  /**
   * The shape of a day: twenty-four buckets, whatever the range.
   *
   * Both figures, as everywhere else — how many pages were opened in each hour,
   * and how many *people* were here in it. The second cannot be derived from
   * the first: one reader working through forty pages between nine and ten is
   * forty views and one person, and which of those two a spike is made of is
   * the entire question.
   *
   * People come from the 24-bit mask on `visit_uniques`. Folding the masks in
   * JavaScript rather than writing twenty-four `SUM((hours >> n) & 1)` columns
   * keeps it one grouped scan over a few hundred distinct masks.
   */
  const foldMasks = (sql: string, ...params: unknown[]): number[] => {
    const out = new Array<number>(24).fill(0)
    for (const r of rows<{ hours: number; n: number }>(sql, ...params)) {
      for (let h = 0; h < 24; h++) if (r.hours & (1 << h)) out[h]! += r.n
    }
    return out
  }

  const viewsByHour = new Map(rows<{ hour: number; views: number }>(
    `SELECT hour, SUM(views) AS views FROM page_views_hourly
      WHERE day >= date('now', ?) GROUP BY hour`, since).map((r) => [r.hour, r.views]))
  const todayViewsByHour = new Map(rows<{ hour: number; views: number }>(
    `SELECT hour, views FROM page_views_hourly WHERE day = date('now')`).map((r) => [r.hour, r.views]))
  const peopleByHour = foldMasks(
    `SELECT hours, COUNT(*) AS n FROM visit_uniques
      WHERE day >= date('now', ?) AND hours != 0 GROUP BY hours`, since)
  const todayPeopleByHour = foldMasks(
    `SELECT hours, COUNT(*) AS n FROM visit_uniques
      WHERE day = date('now') AND hours != 0 GROUP BY hours`)

  /**
   * An average divides by the days that carry data, not by the window.
   *
   * A 90-day range on a site that has been counting for nine of them would
   * otherwise report an average of a tenth of the truth. The two sources are
   * counted separately because they can genuinely differ: a database that
   * predates the hour mask has view rows for days whose visitor rows have no
   * hours in them, and those days are not evidence about people.
   */
  const hourDays = Math.max(1, one(
    `SELECT COUNT(DISTINCT day) AS n FROM page_views_hourly WHERE day >= date('now', ?)`, since))
  const peopleDays = Math.max(1, one(
    `SELECT COUNT(DISTINCT day) AS n FROM visit_uniques
      WHERE day >= date('now', ?) AND hours != 0`, since))

  const round1 = (n: number) => Math.round(n * 10) / 10
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const views = viewsByHour.get(hour) ?? 0
    const people = peopleByHour[hour] ?? 0
    return {
      hour,
      /** Totals across the whole window. */
      views,
      people,
      /** …and the same divided out, which is what makes ranges comparable. */
      avgViews: round1(views / hourDays),
      avgPeople: round1(people / peopleDays),
      todayViews: todayViewsByHour.get(hour) ?? 0,
      todayPeople: todayPeopleByHour[hour] ?? 0,
    }
  })
  /** What the averages above were divided by, so the chart can say so. */
  const hourlyMeta = { viewDays: hourDays, peopleDays }

  // ----------------------------------------------------------------- totals
  const totals = {
    // All time is genuinely all time: the running totals are never pruned.
    viewsAllTime: one(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views`),
    visitorsAllTime: one(`SELECT COUNT(DISTINCT visitor) AS n FROM visit_uniques`),
    viewsToday: one(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE day = date('now')`),
    visitorsToday: one(`SELECT COUNT(*) AS n FROM visit_uniques WHERE day = date('now')`),
    accountsToday: one(`SELECT COUNT(*) AS n FROM account_days WHERE day = date('now')`),
    loginsToday: one(`SELECT COALESCE(SUM(logins), 0) AS n FROM account_days WHERE day = date('now')`),
    views7: one(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE day >= date('now', '-6 days')`),
    visitors7: one(`SELECT COUNT(DISTINCT visitor) AS n FROM visit_uniques WHERE day >= date('now', '-6 days')`),
    views30: one(`SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE day >= date('now', '-29 days')`),
    visitors30: one(`SELECT COUNT(DISTINCT visitor) AS n FROM visit_uniques WHERE day >= date('now', '-29 days')`),
    /** The first day anything was counted — says how long this has been running. */
    countingSince: (db.prepare(`SELECT MIN(day) AS d FROM page_views`).get() as { d: string | null }).d,
  }

  /** The same figures for exactly the window on screen, so the charts add up. */
  const range = {
    views: daily.reduce((s, d) => s + d.views, 0),
    /**
     * Distinct people over the window, not the sum of the daily counts — the
     * same person on Monday and Tuesday is one visitor and two visitor-days.
     */
    visitors: one(`SELECT COUNT(DISTINCT visitor) AS n FROM visit_uniques WHERE day >= date('now', ?)`, since),
    visitorDays: daily.reduce((s, d) => s + d.visitors, 0),
    accounts: one(`SELECT COUNT(DISTINCT account_id) AS n FROM account_days WHERE day >= date('now', ?)`, since),
    logins: daily.reduce((s, d) => s + d.logins, 0),
    busiestDay: daily.reduce<{ day: string; views: number } | null>(
      (best, d) => (!best || d.views > best.views ? { day: d.day, views: d.views } : best), null),
  }

  // ------------------------------------------------------------- top of the
  const topPages = rows<{ path: string; n: number }>(
    `SELECT path, SUM(views) AS n FROM page_views
      WHERE day >= date('now', ?) GROUP BY path ORDER BY n DESC LIMIT 15`, since)

  /**
   * Most-viewed levels *in the window*, from the per-day table.
   *
   * This used to read the running totals and so answered "of all time" under a
   * heading that said thirty days, next to a page list that really was thirty
   * days. `allTime` is still here because it is a fair question — it is just a
   * different one, and now says so.
   */
  const topLevels = rows<{ position: number; sheet_placement: number | null; name: string; n: number }>(
    `SELECT l.position, l.sheet_placement, l.name, SUM(v.views) AS n
       FROM level_view_days v JOIN levels l ON l.id = v.level_id
      WHERE v.day >= date('now', ?)
      GROUP BY v.level_id ORDER BY n DESC LIMIT 15`, since)
  const topLevelsAllTime = rows<{ position: number; sheet_placement: number | null; name: string; n: number; last_viewed_at: string }>(
    `SELECT l.position, l.sheet_placement, l.name, v.views AS n, v.last_viewed_at
       FROM level_views v JOIN levels l ON l.id = v.level_id
      ORDER BY v.views DESC LIMIT 15`)

  const topLists = rows<{ public_id: string; title: string; n: number; owner: string | null }>(
    `SELECT c.public_id, c.title, v.views AS n, a.username AS owner
       FROM custom_list_views v
       JOIN custom_lists c ON c.id = v.list_id
       LEFT JOIN accounts a ON a.id = c.owner_account_id
      ORDER BY v.views DESC LIMIT 10`)

  const topProfiles = rows<{ username: string; n: number }>(
    `SELECT a.username, v.views AS n
       FROM profile_views v JOIN accounts a ON a.id = v.account_id
      WHERE a.banned_at IS NULL
      ORDER BY v.views DESC LIMIT 10`)

  /**
   * What the site gained, per day, from the tables that already record when.
   *
   * Each one is a different kind of contribution — someone joined, someone
   * offered a level, someone proved a completion, someone built a list — and
   * they are worth reading against the traffic beside them.
   */
  const series = (sql: string) =>
    fillDays<{ n: number }>(rows<{ day: string; n: number }>(sql, since), days, ['n'])

  const growth = {
    accounts: series(
      `SELECT DATE(created_at) AS day, COUNT(*) AS n FROM accounts
        WHERE created_at >= date('now', ?) GROUP BY day`),
    /**
     * Levels a *person* offered.
     *
     * The importers put their rows in the same table, and they arrive in the
     * thousands — one mirror refresh buried every real submission the site had
     * ever had under a single day's bar. They are their own series below.
     */
    levelsSubmitted: series(
      `SELECT DATE(submitted_at) AS day, COUNT(*) AS n FROM pending_levels
        WHERE submitted_at >= date('now', ?) AND ${submittedPendingSql()} GROUP BY day`),
    levelsImported: series(
      `SELECT DATE(submitted_at) AS day, COUNT(*) AS n FROM pending_levels
        WHERE submitted_at >= date('now', ?) AND ${importedPendingSql()} GROUP BY day`),
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

  const lifetime = {
    accounts: one(`SELECT COUNT(*) AS n FROM accounts`),
    accountsBanned: one(`SELECT COUNT(*) AS n FROM accounts WHERE banned_at IS NOT NULL`),
    /**
     * Accounts with an *accepted* record. This counted pending ones too, which
     * made it a count of accounts that had ever submitted anything.
     */
    accountsWithRecords: one(
      `SELECT COUNT(DISTINCT a.id) AS n FROM accounts a
         JOIN records r ON r.player_name = COALESCE(a.claimed_player, a.username) COLLATE NOCASE
        WHERE r.permanent = 1`),
    levels: one(`SELECT COUNT(*) AS n FROM levels`),
    levelsSubmitted: one(`SELECT COUNT(*) AS n FROM pending_levels WHERE ${submittedPendingSql()}`),
    levelsSubmittedPending: one(
      `SELECT COUNT(*) AS n FROM pending_levels WHERE status = 'pending' AND ${submittedPendingSql()}`),
    levelsImported: one(`SELECT COUNT(*) AS n FROM pending_levels WHERE ${importedPendingSql()}`),
    levelsImportedPending: one(
      `SELECT COUNT(*) AS n FROM pending_levels WHERE status = 'pending' AND ${importedPendingSql()}`),
    levelsPending: one(`SELECT COUNT(*) AS n FROM pending_levels WHERE status = 'pending'`),
    records: one(`SELECT COUNT(*) AS n FROM records`),
    recordsAccepted: one(`SELECT COUNT(*) AS n FROM records WHERE permanent = 1`),
    recordsPending: one(`SELECT COUNT(*) AS n FROM records WHERE permanent = 0`),
    customLists: one(`SELECT COUNT(*) AS n FROM custom_lists`),
    publicLists: one(`SELECT COUNT(*) AS n FROM custom_lists WHERE is_public = 1`),
    comments: one(`SELECT COUNT(*) AS n FROM comments`),
    opinions: one(`SELECT COUNT(*) AS n FROM opinions`),
    progressPosts: one(`SELECT COUNT(*) AS n FROM progress_posts`),
    follows: one(`SELECT COUNT(*) AS n FROM follows`),
    clans: one(`SELECT COUNT(*) AS n FROM clans`),
    /** How much of the list anybody has ever opened. */
    levelsViewed: one(`SELECT COUNT(*) AS n FROM level_views`),
    listsViewed: one(`SELECT COUNT(*) AS n FROM custom_list_views`),
  }

  return {
    days,
    totals,
    range,
    lifetime,
    daily,
    hourly,
    hourlyMeta,
    topPages,
    topLevels,
    topLevelsAllTime,
    topLists,
    topProfiles,
    growth,
  }
})

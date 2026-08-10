import { getDb } from '~/server/db'
import { isChallengeSql } from '~/server/utils/challenge-expr'

const TIER_ORD_SQL = `
  CASE
    WHEN gddl_tier LIKE 'Subtier %' THEN CAST(SUBSTR(gddl_tier, 9) AS INTEGER)
    WHEN gddl_tier LIKE 'Tier %'    THEN 5 + CAST(SUBSTR(gddl_tier, 6) AS INTEGER)
  END
`

export default defineEventHandler((event) => {
  const db = getDb()

  const tierRows = db
    .prepare(
      `SELECT gddl_tier AS tier, COUNT(*) AS count
       FROM levels
       WHERE gddl_tier LIKE 'Tier %'
       GROUP BY gddl_tier`,
    )
    .all() as { tier: string; count: number }[]
  const tierMap = new Map(tierRows.map((r) => [r.tier, r.count]))
  const maxTierInDb = tierRows.reduce((max, r) => {
    const n = parseInt(r.tier.replace('Tier ', ''), 10)
    return isNaN(n) ? max : Math.max(max, n)
  }, 0)
  const maxTier = Math.max(maxTierInDb, 39)
  const tiers = Array.from({ length: maxTier }, (_, i) => {
    const label = `Tier ${i + 1}`
    return { tier: label, count: tierMap.get(label) ?? 0 }
  })

  const subtierRows = db
    .prepare(
      `SELECT gddl_tier AS tier, COUNT(*) AS count
       FROM levels
       WHERE gddl_tier LIKE 'Subtier %'
       GROUP BY gddl_tier`,
    )
    .all() as { tier: string; count: number }[]
  const subtierMap = new Map(subtierRows.map((r) => [r.tier, r.count]))
  const subtiers = Array.from({ length: 6 }, (_, i) => {
    const label = `Subtier ${i}`
    return { tier: label, count: subtierMap.get(label) ?? 0 }
  })

  const years = db
    .prepare(
      `SELECT SUBSTR(verify_date, 1, 4) AS year, COUNT(*) AS count
       FROM levels
       WHERE verify_date IS NOT NULL AND verify_date <> '' AND SUBSTR(verify_date, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
       GROUP BY year
       ORDER BY year ASC`,
    )
    .all() as { year: string; count: number }[]

  // Difficulty order matches the GD difficulty ladder (easiest → hardest).
  const difficultyOrder = [
    'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
    'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon', 'Official Demon',
  ]
  const diffRows = db
    .prepare(
      `SELECT difficulty AS name, COUNT(*) AS count
       FROM levels
       WHERE difficulty IS NOT NULL AND difficulty <> ''
       GROUP BY difficulty`,
    )
    .all() as { name: string; count: number }[]
  const diffMap = new Map(diffRows.map((r) => [r.name, r.count]))
  const difficulties = difficultyOrder
    .map((name) => ({ name, count: diffMap.get(name) ?? 0 }))
    .filter((r) => r.count > 0)

  // Rating order matches GD's rating tiers + the list-specific extras.
  // A level is bucketed as Challenge if any of:
  //   - its placement_source is in the curated challenge-source list;
  //   - the admin/sheet pinned `rated = 'Challenge'`;
  //   - or it's unrated (score 0) + Tiny/Short per the cached GD API info.
  // The first two reasons override any other `rated` value, mirroring the
  // filter logic in /api/levels and the label in LevelDetail.vue.
  // Shared with the list filter and the level page, so a level unmarked as a
  // challenge stops being counted as one here too. This used to be a fourth
  // hand-written copy that had already lost the "Tier 1+" clause the other
  // three carry.
  const ratingOrder = ['Mythic', 'Legendary', 'Epic', 'Featured', 'Rated', 'Unrated', 'Challenge', 'Official']
  const ratingRows = db
    .prepare(
      `SELECT
         CASE
           WHEN ${isChallengeSql('levels', 'c')} = 1 THEN 'Challenge'
           -- A stored rated of 'Challenge' is a pin, not a rating: it feeds the
           -- expression above, so once that says no the word must not return.
           WHEN rated IS NOT NULL AND rated NOT IN ('', 'Challenge') THEN rated
           ELSE 'Unrated'
         END AS rating_name,
         COUNT(*) AS count
       FROM levels LEFT JOIN gd_info_cache c ON c.gd_id = levels.gd_id
       GROUP BY rating_name`,
    )
    .all() as { rating_name: string; count: number }[]
  const ratingMap = new Map(ratingRows.map((r) => [r.rating_name, r.count]))
  const ratings = ratingOrder
    .map((name) => ({ name, count: ratingMap.get(name) ?? 0 }))
    .filter((r) => r.count > 0)

  // Main skillset, most-used first. Grouped case-insensitively because the
  // sheet spells the same skillset a few different ways across tabs.
  const skillsets = db
    .prepare(
      `SELECT MIN(main_skillset) AS name, COUNT(*) AS count
         FROM levels
        WHERE main_skillset IS NOT NULL AND TRIM(main_skillset) <> ''
        GROUP BY LOWER(TRIM(main_skillset))
        ORDER BY count DESC`,
    )
    .all() as { name: string; count: number }[]

  const totalLevels = (db.prepare(`SELECT COUNT(*) AS n FROM levels`).get() as { n: number }).n
  const totalListPoints = (db.prepare(`SELECT COALESCE(SUM(points), 0) AS s FROM levels`).get() as { s: number }).s
  const siteOnlyLevels = (db.prepare(
    `SELECT COUNT(*) AS n FROM levels WHERE COALESCE(site_only, 0) = 1`,
  ).get() as { n: number }).n
  // Approved records only — `permanent = 1` is what marks a record as accepted.
  const totalRecords = (db.prepare(
    `SELECT COUNT(*) AS n FROM records WHERE permanent = 1`,
  ).get() as { n: number }).n
  const totalPlayers = (db.prepare(
    `SELECT COUNT(DISTINCT player_name COLLATE NOCASE) AS n FROM records WHERE permanent = 1`,
  ).get() as { n: number }).n
  const levelsWithRecords = (db.prepare(
    `SELECT COUNT(DISTINCT level_id) AS n FROM records WHERE permanent = 1`,
  ).get() as { n: number }).n

  /**
   * How often the site has been opened, and since when.
   *
   * Public because it is a fact about the site rather than about anyone using
   * it — the same sort of number as "54,000 levels". The date matters as much
   * as the count: a total with no start is unreadable, and this one started
   * being counted long after the site did.
   */
  const totalVisits = (db.prepare(
    `SELECT COALESCE(SUM(views), 0) AS n FROM page_views`,
  ).get() as { n: number }).n
  const visitsSince = (db.prepare(
    `SELECT MIN(day) AS d FROM page_views`,
  ).get() as { d: string | null }).d

  // The hardest thing on the list, for the headline. Ordered by tier rather
  // than position so it stays right if the two ever disagree.
  const hardest = db
    .prepare(
      `SELECT position, sheet_placement, name, gddl_tier, gd_id
         FROM levels
        WHERE gddl_tier IS NOT NULL
        ORDER BY ${TIER_ORD_SQL} DESC, position ASC
        LIMIT 1`,
    )
    .get() as { position: number; sheet_placement: number | null; name: string; gddl_tier: string; gd_id: number | null } | undefined

  setHeader(event, 'cache-control', 'public, max-age=60')
  return {
    totalLevels,
    totalListPoints,
    siteOnlyLevels,
    totalRecords,
    totalPlayers,
    levelsWithRecords,
    totalVisits,
    visitsSince,
    hardest: hardest ?? null,
    tiers,
    subtiers,
    years,
    difficulties,
    ratings,
    skillsets,
  }
})

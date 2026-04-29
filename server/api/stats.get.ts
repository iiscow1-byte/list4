import { getDb } from '~/server/db'

const TIER_ORD_SQL = `
  CASE
    WHEN gddl_tier LIKE 'Subtier %' THEN CAST(SUBSTR(gddl_tier, 9) AS INTEGER)
    WHEN gddl_tier LIKE 'Tier %'    THEN 5 + CAST(SUBSTR(gddl_tier, 6) AS INTEGER)
  END
`

export default defineEventHandler((event) => {
  const db = getDb()

  const tiers = db
    .prepare(
      `SELECT gddl_tier AS tier, COUNT(*) AS count
       FROM levels
       WHERE gddl_tier LIKE 'Tier %'
       GROUP BY gddl_tier
       ORDER BY ${TIER_ORD_SQL} ASC`,
    )
    .all() as { tier: string; count: number }[]

  const subtiers = db
    .prepare(
      `SELECT gddl_tier AS tier, COUNT(*) AS count
       FROM levels
       WHERE gddl_tier LIKE 'Subtier %'
       GROUP BY gddl_tier
       ORDER BY ${TIER_ORD_SQL} ASC`,
    )
    .all() as { tier: string; count: number }[]

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
  const ratingOrder = ['Mythic', 'Legendary', 'Epic', 'Featured', 'Rated', 'Unrated', 'Challenge', 'Official']
  const ratingRows = db
    .prepare(
      `SELECT COALESCE(NULLIF(rated, ''), 'Unrated') AS rating_name, COUNT(*) AS count
       FROM levels
       GROUP BY rating_name`,
    )
    .all() as { rating_name: string; count: number }[]
  const ratingMap = new Map(ratingRows.map((r) => [r.rating_name, r.count]))
  const ratings = ratingOrder
    .map((name) => ({ name, count: ratingMap.get(name) ?? 0 }))
    .filter((r) => r.count > 0)

  const totalLevels = (db.prepare(`SELECT COUNT(*) AS n FROM levels`).get() as { n: number }).n
  const totalListPoints = (db.prepare(`SELECT COALESCE(SUM(points), 0) AS s FROM levels`).get() as { s: number }).s

  setHeader(event, 'cache-control', 'public, max-age=60')
  return {
    totalLevels,
    totalListPoints,
    tiers,
    subtiers,
    years,
    difficulties,
    ratings,
  }
})

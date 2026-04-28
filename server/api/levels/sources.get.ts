import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT placement_source AS source, COUNT(*) AS count
       FROM levels
       WHERE placement_source IS NOT NULL AND placement_source <> ''
       GROUP BY placement_source
       ORDER BY count DESC, placement_source COLLATE NOCASE ASC`,
    )
    .all() as { source: string; count: number }[]

  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')
  return { sources: rows }
})

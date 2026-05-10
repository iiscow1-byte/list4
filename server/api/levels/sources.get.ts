import { getDb } from '~/server/db'

export default defineEventHandler((event) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT placement_source FROM levels
       WHERE placement_source IS NOT NULL AND placement_source <> ''`,
    )
    .all() as { placement_source: string }[]

  const counts = new Map<string, number>()
  for (const { placement_source } of rows) {
    for (const s of placement_source.split('|').map((v) => v.trim()).filter(Boolean)) {
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
  }

  const sources = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([source, count]) => ({ source, count }))

  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')
  return { sources }
})

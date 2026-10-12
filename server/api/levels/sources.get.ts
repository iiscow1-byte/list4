import { getDb } from '~/server/db'
import { compareNames } from '~/utils/collate'
import { onListChange } from '~/server/utils/list-ops'

/** Every placement source and how many levels carry it. Cached until the list changes. */
let cached: { source: string; count: number }[] | null = null
onListChange(() => { cached = null })

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')
  if (cached) return { sources: cached }
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
    .sort((a, b) => b[1] - a[1] || compareNames(a[0], b[0]))
    .map(([source, count]) => ({ source, count }))

  cached = sources
  return { sources }
})

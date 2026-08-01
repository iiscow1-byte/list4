import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { countSourceRows, isKnownSource, loadSourceRows } from '~/server/utils/list-sources'

/**
 * How many levels the current "create a custom list" filters would pull in,
 * plus the first few names. Uses the same source registry as the create
 * endpoint, so the preview can't promise a different set than it produces.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const source = String(q.source ?? 'all')
  if (!isKnownSource(source)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown list source: ${source}` })
  }

  const filter = {
    from_position: q.from_position != null ? Number(q.from_position) : null,
    to_position: q.to_position != null ? Number(q.to_position) : null,
    // Tier / rating only exist on the ALL list; the mirrors ignore them.
    tier: source === 'all' && q.tier ? String(q.tier) : null,
    rated: source === 'all' && q.rated ? String(q.rated) : null,
  }

  const db = getDb()
  const total = countSourceRows(db, source, filter)
  const sample = loadSourceRows(db, source, filter, 5).map((r) => ({
    position: r.position,
    sheet_placement: r.display_position,
    name: r.name,
  }))

  return { total, sample, source }
})

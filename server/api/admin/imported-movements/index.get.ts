import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { computeImportedMovements, importedMovementSummary } from '~/server/utils/imported-movements'
import { sourceLabel } from '~/utils/list-source-catalog'

/**
 * Levels an imported list ranks differently to the ALL.
 *
 * Always returns the per-source summary so the picker can show which lists have
 * anything to say; `?source=` adds that list's rows. Computed on request rather
 * than stored — the answer changes every time a level moves or a list is
 * re-imported, and a stored copy would quietly go stale.
 */
const MAX_ITEMS = 400

export default defineEventHandler((event) => {
  requireMod(event)
  const db = getDb()
  const source = String(getQuery(event).source ?? '').trim()
  const includeDismissed = String(getQuery(event).dismissed ?? '') === '1'

  const sources = importedMovementSummary(db)
  if (!source) return { sources, source: null, items: [], shared: 0, total: 0 }

  if (!sources.some((s) => s.key === source)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown or empty list source: ${source}` })
  }

  const { items, shared } = computeImportedMovements(db, source)
  const visible = includeDismissed ? items : items.filter((i) => !i.dismissed)

  return {
    sources,
    source,
    label: sourceLabel(source),
    shared,
    total: visible.length,
    items: visible.slice(0, MAX_ITEMS),
  }
})

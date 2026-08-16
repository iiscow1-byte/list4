import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { GDTPL_LISTS, gdtplPendingWhere } from '~/server/db/gdtpl-lists'

// SQL fragments that select the pending_levels rows attributable to a given
// import source. Each must select rows that haven't been approved/rejected
// yet (status = 'pending') so we never delete a level that's already been
// merged into the main list.
const SELECTORS: Record<string, { sql: string; params?: any[] }> = {
  'sheet': {
    sql: `from_sheet_pending = 1 AND status = 'pending'`,
  },
  'gdl': {
    sql: `from_gdl_id IS NOT NULL AND status = 'pending'`,
  },
  'acs': {
    sql: `from_acs_id IS NOT NULL AND status = 'pending'`,
  },
  // Every GDListTemplate list, from the one registry — so a list can never be
  // importable but unclearable, which is what happened each time one of these
  // was added to the runner map and not to this one.
  ...Object.fromEntries(
    GDTPL_LISTS.map((l) => [l.config.source, { sql: gdtplPendingWhere(l.config.source) }]),
  ),
  // Not a GDListTemplate wrapper — it has its own importer — but it files its
  // rows under a `gdtpl_levels` slug all the same.
  'cl': {
    sql: gdtplPendingWhere('cl'),
  },
  'all': {
    sql: `status = 'pending' AND (from_sheet_pending = 1 OR from_gdl_id IS NOT NULL OR from_gdtpl_id IS NOT NULL)`,
  },
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody<{ source?: string }>(event)
  const source = String(body?.source ?? '').toLowerCase()
  const sel = SELECTORS[source]
  if (!sel) {
    throw createError({ statusCode: 400, statusMessage: `Unknown source: ${source}` })
  }

  const db = getDb()
  const result = db.prepare(`DELETE FROM pending_levels WHERE ${sel.sql}`).run(...(sel.params ?? []))
  return { ok: true, source, deleted: result.changes }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

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
  'tsl': {
    sql: `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = 'tsl')`,
  },
  'edi': {
    sql: `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = 'edi')`,
  },
  'ccl': {
    sql: `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = 'ccl')`,
  },
  'll': {
    sql: `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = 'll')`,
  },
  'tcl': {
    sql: `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = 'tcl')`,
  },
  'sfl': {
    sql: `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = 'sfl')`,
  },
  'ddl': {
    sql: `status = 'pending' AND from_gdtpl_id IN (SELECT id FROM gdtpl_levels WHERE list_slug = 'ddl')`,
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

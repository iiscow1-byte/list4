import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { loadList } from '~/server/utils/custom-lists'

/**
 * Edit one level on a list in place, from the list page itself.
 *
 * Which fields are writable depends on whether the row is linked to an ALL
 * level. Linked rows take their name/creator/difficulty/tier/video from
 * `levels` on every full save — writing them here would look like it worked
 * and then silently revert — so only the list's own metadata is editable
 * there. Hand-entered rows own all of it.
 */

/** Editable on every row: these belong to the list, not to the level. */
const LIST_OWNED = ['notes', 'verifier', 'fps', 'game_version'] as const
/** Editable only when the row isn't pointing at an ALL level. */
const LEVEL_OWNED = ['name', 'creator', 'difficulty', 'gddl_tier', 'verification_url'] as const

const MAX_LEN: Record<string, number> = {
  notes: 500, verifier: 200, fps: 40, game_version: 40,
  name: 200, creator: 200, difficulty: 60, gddl_tier: 40, verification_url: 500,
}

export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const itemId = Number(getRouterParam(event, 'item_id'))
  const body = await readBody<Record<string, unknown>>(event) ?? {}

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list' })
  }

  const row = db.prepare(
    `SELECT id, level_id FROM custom_list_items WHERE id = ? AND list_id = ?`,
  ).get(itemId, list.id) as { id: number; level_id: number | null } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'That level is not on this list.' })

  const writable: string[] = [...LIST_OWNED, ...(row.level_id == null ? LEVEL_OWNED : [])]
  const sets: string[] = []
  const params: any[] = []

  for (const key of writable) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw === null || raw === '') {
      sets.push(`${key} = ?`)
      params.push(null)
      continue
    }
    if (typeof raw !== 'string') continue
    sets.push(`${key} = ?`)
    params.push(raw.trim().slice(0, MAX_LEN[key] ?? 200) || null)
  }

  // Percent is numeric and clamped rather than trimmed.
  if ('percent_to_qualify' in body) {
    const n = Number(body.percent_to_qualify)
    sets.push(`percent_to_qualify = ?`)
    params.push(Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 100)
  }
  // gd_id only matters for hand-entered rows; it drives the thumbnail.
  if (row.level_id == null && 'gd_id' in body) {
    const n = Number(body.gd_id)
    sets.push(`gd_id = ?`)
    params.push(Number.isInteger(n) && n > 0 ? n : null)
  }

  if (!sets.length) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update.' })
  }

  db.prepare(`UPDATE custom_list_items SET ${sets.join(', ')} WHERE id = ? AND list_id = ?`)
    .run(...params, itemId, list.id)
  db.prepare(`UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?`).run(list.id)

  return { ok: true, list: loadList(db, list.id) }
})

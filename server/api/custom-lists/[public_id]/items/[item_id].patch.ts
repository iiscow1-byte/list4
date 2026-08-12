import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { loadList } from '~/server/utils/custom-lists'
import { isValidTier } from '~/utils/tier-ordinal'

/**
 * Edit one level on a list in place, from the list page itself.
 *
 * The list's own metadata — notes, verifier, FPS, game version, % to qualify —
 * has always been editable on every row. The level's own fields used to be
 * editable only on hand-entered rows: a linked row re-reads them from `levels`
 * on every save, so writing them here looked like it worked and then silently
 * reverted at the next save.
 *
 * They are editable everywhere now, because "the main list has the wrong video
 * for this level" and "our community verifies this level differently" are real
 * and a custom list had no way to say either. On a linked row the value goes
 * into that field's `ov_` column, which is read in preference to the mirrored
 * one and is never touched by a full save. Sending back exactly what the ALL
 * currently says clears the override instead of pinning it — otherwise opening
 * the editor and pressing Save would quietly freeze the row against the main
 * list forever.
 */

/** Editable on every row: these belong to the list, not to the level. */
const LIST_OWNED = ['notes', 'verifier', 'fps', 'game_version'] as const
/** The level's own fields — direct on a hand-entered row, `ov_` on a linked one. */
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
    `SELECT id, level_id, name, creator, difficulty, gddl_tier, verification_url
       FROM custom_list_items WHERE id = ? AND list_id = ?`,
  ).get(itemId, list.id) as
    { id: number; level_id: number | null } & Record<string, string | null> | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'That level is not on this list.' })

  const linked = row.level_id != null
  const sets: string[] = []
  const params: (string | number | null)[] = []

  const clean = (key: string, raw: unknown): string | null => {
    if (raw === null || raw === '' || raw === undefined) return null
    if (typeof raw !== 'string') return null
    return raw.trim().slice(0, MAX_LEN[key] ?? 200) || null
  }

  for (const key of LIST_OWNED) {
    if (!(key in body)) continue
    sets.push(`${key} = ?`)
    params.push(clean(key, body[key]))
  }

  for (const key of LEVEL_OWNED) {
    if (!(key in body)) continue
    const value = clean(key, body[key])
    if (key === 'gddl_tier' && value && !isValidTier(value)) {
      throw createError({ statusCode: 400, statusMessage: `"${value}" isn't a tier.` })
    }
    if (!linked) {
      sets.push(`${key} = ?`)
      params.push(value)
      continue
    }
    // A linked row: the mirrored column is the ALL's answer and stays that way.
    // Matching it means "no opinion of my own", which is the absence of an
    // override rather than an override that happens to agree.
    sets.push(`ov_${key} = ?`)
    params.push(value === row[key] ? null : value)
  }

  /**
   * Whether the list calls this row a challenge.
   *
   * List-owned, and deliberately so even on a row linked to the ALL: the ALL
   * decides what *it* considers a challenge from the level's rating, length and
   * source, and a list that exists to rank challenges by its own definition
   * would be overruled by that on every save. Boolean rather than a string, so
   * `clean()` above cannot be used — it would turn `false` into null and leave
   * the flag stuck on.
   */
  if ('is_challenge' in body) {
    sets.push(`is_challenge = ?`)
    params.push(body.is_challenge ? 1 : 0)
  }

  // Percent is numeric and clamped rather than trimmed.
  if ('percent_to_qualify' in body) {
    const n = Number(body.percent_to_qualify)
    sets.push(`percent_to_qualify = ?`)
    params.push(Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 100)
  }
  // gd_id only matters for hand-entered rows; on a linked one the link is the
  // identity and the id comes with it.
  if (!linked && 'gd_id' in body) {
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

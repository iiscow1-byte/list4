import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { loadList, resolveAllLevel } from '~/server/utils/custom-lists'

/**
 * Link a custom-list row to a level on the ALL list, or cut it loose.
 *
 * Linking is normally automatic, but the resolver refuses to guess when a
 * `gd_id` is shared by several variants (Solo/2P, Old/Unnerfed) — this is how
 * an editor settles it. `level_id` links to a specific level; omitting it asks
 * the resolver to try again; `unlink: true` goes back to hand-entered.
 *
 * A linked row takes its name, creator, tier and video from `levels` on every
 * save, so the response returns the whole list — the row the client is holding
 * is stale the moment this succeeds.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const itemId = Number(getRouterParam(event, 'item_id'))
  const body = await readBody<{ level_id?: number; unlink?: boolean }>(event) ?? {}

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list' })
  }

  const row = db.prepare(
    `SELECT id, name, gd_id, level_id FROM custom_list_items WHERE id = ? AND list_id = ?`,
  ).get(itemId, list.id) as
    { id: number; name: string; gd_id: number | null; level_id: number | null } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'That level is not on this list.' })

  if (body.unlink) {
    // Fold any overrides down into the row's own fields on the way out.
    // "Override the ALL" stops meaning anything once the row isn't pointing at
    // the ALL, and leaving both sets populated would make the row show one
    // value and store another.
    db.prepare(
      `UPDATE custom_list_items
          SET level_id = NULL,
              name             = COALESCE(ov_name, name),
              creator          = COALESCE(ov_creator, creator),
              difficulty       = COALESCE(ov_difficulty, difficulty),
              gddl_tier        = COALESCE(ov_gddl_tier, gddl_tier),
              verification_url = COALESCE(ov_verification_url, verification_url),
              ov_name = NULL, ov_creator = NULL, ov_difficulty = NULL,
              ov_gddl_tier = NULL, ov_verification_url = NULL
        WHERE id = ?`,
    ).run(itemId)
    db.prepare(`UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?`).run(list.id)
    return { ok: true, linked: false, list: loadList(db, list.id) }
  }

  // An explicit id is trusted as far as "that level exists"; anything else goes
  // through the same conservative resolver the automatic path uses.
  let levelId: number | null = null
  const wanted = Number(body.level_id)
  if (Number.isInteger(wanted) && wanted > 0) {
    const exists = db.prepare(`SELECT id FROM levels WHERE id = ?`).get(wanted) as { id: number } | undefined
    if (!exists) throw createError({ statusCode: 404, statusMessage: 'No such level on the ALL list.' })
    levelId = wanted
  } else {
    levelId = resolveAllLevel(db, { gdId: row.gd_id, name: row.name })
  }

  if (levelId == null) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No level on the ALL list matches this one clearly enough to link automatically.',
    })
  }

  // Adopt the ALL list's data immediately, so the row doesn't keep showing the
  // hand-entered values until the next full save.
  const lvl = db.prepare(
    `SELECT id, name, gd_id, creator, difficulty, gddl_tier, verification_url
       FROM levels WHERE id = ?`,
  ).get(levelId) as any
  db.prepare(
    `UPDATE custom_list_items
        SET level_id = ?, name = ?, gd_id = ?, creator = ?, difficulty = ?,
            gddl_tier = ?, verification_url = ?
      WHERE id = ? AND list_id = ?`,
  ).run(
    lvl.id, lvl.name, lvl.gd_id, lvl.creator, lvl.difficulty, lvl.gddl_tier,
    lvl.verification_url, itemId, list.id,
  )
  db.prepare(`UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?`).run(list.id)

  return { ok: true, linked: true, level_id: lvl.id, list: loadList(db, list.id) }
})

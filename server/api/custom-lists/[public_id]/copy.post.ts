import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { loadList, newPublicId, MAX_LISTS_PER_USER } from '~/server/utils/custom-lists'

/**
 * Fork a public list into the caller's own lists. The copy starts private and
 * remembers what it came from via `copied_from_id`.
 */
export default defineEventHandler((event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')

  const db = getDb()
  const src = db.prepare(
    `SELECT id, title, description, is_public, owner_account_id, mark_off_all FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as
    { id: number; title: string; description: string | null; is_public: number; owner_account_id: number; mark_off_all: number } | undefined
  if (!src) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!src.is_public && src.owner_account_id !== account.id) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }

  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM custom_lists WHERE owner_account_id = ?`,
  ).get(account.id) as { n: number }).n
  if (count >= MAX_LISTS_PER_USER) {
    throw createError({ statusCode: 400, statusMessage: `You can have at most ${MAX_LISTS_PER_USER} lists.` })
  }

  db.exec('BEGIN')
  try {
    const info = db.prepare(
      `INSERT INTO custom_lists (public_id, owner_account_id, title, description, copied_from_id, mark_off_all)
       VALUES (?,?,?,?,?,?)`,
    ).run(
      newPublicId(), account.id, `${src.title} (copy)`.slice(0, 120), src.description, src.id,
      src.mark_off_all ?? 1,
    )
    const newId = Number(info.lastInsertRowid)
    db.prepare(
      // Overrides come with the copy: they are part of what the list says about
      // its levels, and a copy that silently reverted to the ALL's video for
      // every row would not be a copy of what was on screen.
      // `is_challenge` copies for the same reason the overrides do: it is the
      // source list's own editorial call, visible on every row, and a copy that
      // dropped it would differ from what was on screen.
      `INSERT INTO custom_list_items
         (list_id, sort_order, level_id, name, gd_id, creator, difficulty, gddl_tier, verification_url, notes,
          ov_name, ov_creator, ov_difficulty, ov_gddl_tier, ov_verification_url, is_challenge)
       SELECT ?, sort_order, level_id, name, gd_id, creator, difficulty, gddl_tier, verification_url, notes,
              ov_name, ov_creator, ov_difficulty, ov_gddl_tier, ov_verification_url, is_challenge
         FROM custom_list_items WHERE list_id = ?
        ORDER BY sort_order ASC`,
    ).run(newId, src.id)
    db.exec('COMMIT')
    return { ok: true, list: loadList(db, newId) }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

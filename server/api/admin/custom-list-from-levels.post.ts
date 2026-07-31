import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { loadList, newPublicId, MAX_ITEMS } from '~/server/utils/custom-lists'

/**
 * Snapshot a slice of the main list into a custom list the admin owns.
 *
 * The point is to seed a real list quickly — "top 100", "everything in Tier
 * 30", the current challenge set — and then curate it by hand. Items are
 * linked to their `levels` row, so they keep following the ALL list for names
 * and metadata.
 */
export default defineEventHandler(async (event) => {
  const account = requireAdmin(event)
  const body = await readBody<{
    title?: string
    description?: string
    from_position?: number
    to_position?: number
    tier?: string
    rated?: string
    limit?: number
    is_public?: boolean
  }>(event)

  const db = getDb()

  const conds: string[] = []
  const params: any[] = []
  const from = Number(body?.from_position)
  const to = Number(body?.to_position)
  if (Number.isInteger(from) && from > 0) { conds.push('position >= ?'); params.push(from) }
  if (Number.isInteger(to) && to > 0) { conds.push('position <= ?'); params.push(to) }
  if (body?.tier) { conds.push('gddl_tier = ?'); params.push(String(body.tier)) }
  if (body?.rated) { conds.push('rated = ?'); params.push(String(body.rated)) }

  const limit = Math.max(1, Math.min(Number(body?.limit) || MAX_ITEMS, MAX_ITEMS))
  const rows = db.prepare(
    `SELECT id, name, gd_id, creator, difficulty, gddl_tier, verification_url
       FROM levels
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY position ASC
      LIMIT ?`,
  ).all(...params, limit) as any[]

  if (!rows.length) {
    throw createError({ statusCode: 400, statusMessage: 'That selection matched no levels.' })
  }

  const title = String(body?.title ?? '').trim().slice(0, 120)
    || `ALL #${rows.length > 0 ? from || 1 : 1}–${(from || 1) + rows.length - 1}`

  db.exec('BEGIN')
  try {
    const info = db.prepare(
      `INSERT INTO custom_lists (public_id, owner_account_id, title, description, is_public)
       VALUES (?,?,?,?,?)`,
    ).run(
      newPublicId(), account.id, title,
      String(body?.description ?? '').trim().slice(0, 2000) || null,
      body?.is_public ? 1 : 0,
    )
    const listId = Number(info.lastInsertRowid)

    const ins = db.prepare(
      `INSERT INTO custom_list_items
         (list_id, sort_order, level_id, name, gd_id, creator, difficulty, gddl_tier, verification_url)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    rows.forEach((r, i) => {
      ins.run(listId, i, r.id, r.name, r.gd_id, r.creator, r.difficulty, r.gddl_tier, r.verification_url)
    })
    db.exec('COMMIT')
    return { ok: true, list: loadList(db, listId) }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

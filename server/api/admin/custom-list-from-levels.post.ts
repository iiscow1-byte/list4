import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { loadList, newPublicId, MAX_ITEMS } from '~/server/utils/custom-lists'
import { isKnownSource, linkToAllLevels, loadSourceRows, sourceShortLabel } from '~/server/utils/list-sources'

/**
 * Snapshot a slice of any imported list into a custom list the admin owns.
 *
 * The point is to seed a real list quickly — "top 100", "everything in Tier
 * 30", "all of CCL" — and then curate it by hand. `source` picks which list to
 * pull from: the ALL list, or any mirror the site imports.
 *
 * Rows are linked to a `levels` row wherever the same level exists on the ALL
 * list, so the copy keeps following the ALL list for names and metadata; rows
 * that only exist on the mirror are stored as hand-entered items.
 */
export default defineEventHandler(async (event) => {
  const account = requireAdmin(event)
  const body = await readBody<{
    title?: string
    description?: string
    source?: string
    from_position?: number
    to_position?: number
    tier?: string
    rated?: string
    limit?: number
    is_public?: boolean
  }>(event)

  const db = getDb()

  const source = String(body?.source ?? 'all')
  if (!isKnownSource(source)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown list source: ${source}` })
  }

  const from = Number(body?.from_position)
  const filter = {
    from_position: body?.from_position ?? null,
    to_position: body?.to_position ?? null,
    tier: source === 'all' ? (body?.tier ?? null) : null,
    rated: source === 'all' ? (body?.rated ?? null) : null,
  }

  const limit = Math.max(1, Math.min(Number(body?.limit) || MAX_ITEMS, MAX_ITEMS))
  const rows = linkToAllLevels(db, loadSourceRows(db, source, filter, limit))

  if (!rows.length) {
    throw createError({ statusCode: 400, statusMessage: 'That selection matched no levels.' })
  }

  const start = Number.isInteger(from) && from > 0 ? from : (rows[0]!.display_position || 1)
  const title = String(body?.title ?? '').trim().slice(0, 120)
    || `${sourceShortLabel(source)} #${start}–${start + rows.length - 1}`

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
         (list_id, sort_order, level_id, name, gd_id, creator, difficulty, gddl_tier,
          verification_url, verifier)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    rows.forEach((r, i) => {
      ins.run(
        listId, i, r.level_id, r.name, r.gd_id, r.creator, null, r.gddl_tier,
        r.verification_url, r.verifier,
      )
    })
    db.exec('COMMIT')
    return { ok: true, count: rows.length, source, list: loadList(db, listId) }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

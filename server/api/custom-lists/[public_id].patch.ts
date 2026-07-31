import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { loadList, replaceItems, type CustomListItemInput } from '~/server/utils/custom-lists'

/** Owner-only update. Any provided field replaces the stored one wholesale. */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{
    title?: string
    description?: string
    items?: CustomListItemInput[]
    is_public?: boolean
  }>(event)

  const db = getDb()
  const row = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (row.owner_account_id !== account.id) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list' })
  }

  db.exec('BEGIN')
  try {
    if (typeof body?.title === 'string') {
      db.prepare(`UPDATE custom_lists SET title = ? WHERE id = ?`)
        .run(body.title.trim().slice(0, 120) || 'My list', row.id)
    }
    if (typeof body?.description === 'string') {
      db.prepare(`UPDATE custom_lists SET description = ? WHERE id = ?`)
        .run(body.description.trim().slice(0, 2000) || null, row.id)
    }
    if (typeof body?.is_public === 'boolean') {
      db.prepare(`UPDATE custom_lists SET is_public = ? WHERE id = ?`)
        .run(body.is_public ? 1 : 0, row.id)
    }
    if (Array.isArray(body?.items)) replaceItems(db, row.id, body.items)
    db.prepare(`UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?`).run(row.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { ok: true, list: loadList(db, row.id) }
})

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import {
  loadList, newPublicId, replaceItems, MAX_LISTS_PER_USER,
  type CustomListItemInput,
} from '~/server/utils/custom-lists'

/** Create a list. Items are optional — the builder saves title + rows at once. */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const body = await readBody<{
    title?: string
    description?: string
    items?: CustomListItemInput[]
    is_public?: boolean
  }>(event)

  const db = getDb()
  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM custom_lists WHERE owner_account_id = ?`,
  ).get(account.id) as { n: number }).n
  if (count >= MAX_LISTS_PER_USER) {
    throw createError({ statusCode: 400, statusMessage: `You can have at most ${MAX_LISTS_PER_USER} lists.` })
  }

  const title = String(body?.title ?? '').trim().slice(0, 120) || 'My list'
  const description = String(body?.description ?? '').trim().slice(0, 2000) || null

  db.exec('BEGIN')
  try {
    const info = db.prepare(
      `INSERT INTO custom_lists (public_id, owner_account_id, title, description, is_public)
       VALUES (?,?,?,?,?)`,
    ).run(newPublicId(), account.id, title, description, body?.is_public ? 1 : 0)
    const listId = Number(info.lastInsertRowid)
    replaceItems(db, listId, Array.isArray(body?.items) ? body.items : [], account.id)
    db.exec('COMMIT')
    return { ok: true, list: loadList(db, listId) }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})

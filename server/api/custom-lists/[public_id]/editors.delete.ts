import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canAdministerList, loadEditors } from '~/server/utils/custom-list-perms'

/**
 * Remove an editor. The owner can remove anyone; an editor can remove
 * themselves (stepping down doesn't need the owner's involvement).
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const accountId = Number(getQuery(event).account_id)
  if (!Number.isInteger(accountId)) {
    throw createError({ statusCode: 400, statusMessage: 'account_id is required.' })
  }

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  if (!canAdministerList(list, account) && account.id !== accountId) {
    throw createError({ statusCode: 403, statusMessage: 'Only the list owner can manage editors.' })
  }

  db.prepare(`DELETE FROM custom_list_editors WHERE list_id = ? AND account_id = ?`)
    .run(list.id, accountId)

  return { ok: true, editors: loadEditors(db, list.id) }
})

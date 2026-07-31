import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { canAdministerList, loadEditors } from '~/server/utils/custom-list-perms'

/** The list's editor roster. Public for public lists so credit is visible. */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, is_public FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; is_public: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const me = getCurrentAccount(event)
  const canManage = canAdministerList(list, me)
  if (!list.is_public && !canManage) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }

  return { editors: loadEditors(db, list.id), can_manage: canManage }
})

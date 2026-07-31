import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { canEditList, canAdministerList, loadEditors } from '~/server/utils/custom-list-perms'
import { loadList } from '~/server/utils/custom-lists'

/** Public read by share token. `can_edit` tells the client to show controls. */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const db = getDb()
  const row = db.prepare(`SELECT id FROM custom_lists WHERE public_id = ?`).get(publicId) as { id: number } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const list = loadList(db, row.id)!
  const me = getCurrentAccount(event)
  const liked_by_me = me
    ? !!db.prepare(`SELECT 1 FROM custom_list_likes WHERE list_id = ? AND account_id = ?`)
        .get(row.id, me.id)
    : false
  return {
    list,
    can_edit: canEditList(db, list, me),
    can_manage: canAdministerList(list, me),
    editors: loadEditors(db, row.id),
    liked_by_me,
  }
})

import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { loadList } from '~/server/utils/custom-lists'

/** Public read by share token. `can_edit` tells the client to show controls. */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const db = getDb()
  const row = db.prepare(`SELECT id FROM custom_lists WHERE public_id = ?`).get(publicId) as { id: number } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const list = loadList(db, row.id)!
  const me = getCurrentAccount(event)
  return { list, can_edit: !!me && me.id === list.owner_account_id }
})

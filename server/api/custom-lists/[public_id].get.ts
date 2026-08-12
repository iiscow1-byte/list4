import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { canEditList, canAdministerList, loadEditors } from '~/server/utils/custom-list-perms'
import { loadList } from '~/server/utils/custom-lists'
import { looksAutomated, recordListView, viewerOf } from '~/server/utils/analytics'

/**
 * Public read by share token. `can_edit` tells the client to show controls.
 *
 * This is also where a list's view count comes from. Somebody who spends an
 * evening building a list and shares it had no way to find out whether anyone
 * opened it — the site counted `/lists/:id` as one shape for every list, on
 * purpose, so the per-day table wouldn't grow with the gallery.
 *
 * Read before the increment, so the number a page shows is the one it was
 * opened with rather than one that includes itself.
 */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const db = getDb()
  const row = db.prepare(`SELECT id FROM custom_lists WHERE public_id = ?`).get(publicId) as { id: number } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const list = loadList(db, row.id)!
  const me = getCurrentAccount(event)
  const views = (db.prepare(`SELECT views FROM custom_list_views WHERE list_id = ?`)
    .get(row.id) as { views: number } | undefined)?.views ?? 0
  // The owner reloading their own draft is not a reader.
  if (me?.id !== list.owner_account_id && !looksAutomated(getHeader(event, 'user-agent') ?? '')) {
    recordListView(row.id, viewerOf(event))
  }
  const liked_by_me = me
    ? !!db.prepare(`SELECT 1 FROM custom_list_likes WHERE list_id = ? AND account_id = ?`)
        .get(row.id, me.id)
    : false
  return {
    list,
    views,
    can_edit: canEditList(db, list, me),
    can_manage: canAdministerList(list, me),
    editors: loadEditors(db, row.id),
    liked_by_me,
  }
})

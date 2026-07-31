import { getDb } from '~/server/db'
import { requireAccount, isAdminRole } from '~/server/utils/auth'

/** Remove a record from a custom list — owner, site admin, or its submitter. */
export default defineEventHandler((event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const recordId = Number(getRouterParam(event, 'record_id'))

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const record = db.prepare(
    `SELECT id, submitted_by FROM custom_list_records WHERE id = ? AND list_id = ?`,
  ).get(recordId, list.id) as { id: number; submitted_by: number | null } | undefined
  if (!record) throw createError({ statusCode: 404, statusMessage: 'Record not found' })

  const allowed = list.owner_account_id === account.id
    || isAdminRole(account.role)
    || record.submitted_by === account.id
  if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Not allowed.' })

  db.prepare(`DELETE FROM custom_list_records WHERE id = ?`).run(recordId)
  return { ok: true }
})

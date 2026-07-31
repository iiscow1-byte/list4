import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { sendInboxMessage } from '~/server/utils/inbox'
import { notifyListWebhooks } from '~/server/utils/custom-list-webhooks'

/**
 * Approve or reject a record on a custom list. Restricted to the list's owner
 * (and site admins). The submitter gets an inbox message either way, with the
 * rejection reason when there is one.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const recordId = Number(getRouterParam(event, 'record_id'))
  const body = await readBody<{ action?: string; reason?: string }>(event)
  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'action must be approve or reject.' })
  }

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, title FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; title: string } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list.' })
  }

  const record = db.prepare(
    `SELECT r.id, r.submitted_by, r.player_name, r.percent, i.name AS level_name
       FROM custom_list_records r
       JOIN custom_list_items i ON i.id = r.item_id
      WHERE r.id = ? AND r.list_id = ?`,
  ).get(recordId, list.id) as
    { id: number; submitted_by: number | null; player_name: string; percent: number; level_name: string } | undefined
  if (!record) throw createError({ statusCode: 404, statusMessage: 'Record not found' })

  const reason = String(body?.reason ?? '').trim().slice(0, 500) || null

  db.prepare(
    `UPDATE custom_list_records
        SET status = ?, reject_reason = ?, decided_by = ?, decided_at = datetime('now')
      WHERE id = ?`,
  ).run(action === 'approve' ? 'approved' : 'rejected', action === 'reject' ? reason : null, account.id, recordId)

  if (record.submitted_by && record.submitted_by !== account.id) {
    sendInboxMessage(db, record.submitted_by, {
      kind: 'custom_list_record',
      subject: action === 'approve'
        ? `Your record on "${list.title}" was accepted`
        : `Your record on "${list.title}" was rejected`,
      body: `${record.player_name} — ${record.level_name} at ${record.percent}%.`
        + (action === 'reject' && reason ? `\n\nReason: ${reason}` : ''),
      sent_by: account.id,
      related_kind: 'custom_list',
      related_id: list.id,
    })
  }

  if (action === 'approve') {
    notifyListWebhooks(db, list.id, 'records', {
      title: `Record accepted on ${list.title}`,
      description: `**${record.player_name}** — ${record.level_name} at ${record.percent}%`,
    }).catch(() => {})
  }

  return { ok: true, status: action === 'approve' ? 'approved' : 'rejected' }
})

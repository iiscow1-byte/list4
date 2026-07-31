import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { appendApprovedLevel } from '~/server/utils/custom-list-pending'
import { notifyListWebhooks } from '~/server/utils/custom-list-webhooks'
import { sendInboxMessage } from '~/server/utils/inbox'

/** Approve a suggested level onto the list, or reject it with a reason. */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const pendingId = Number(getRouterParam(event, 'pending_id'))
  const body = await readBody<{ action?: string; reason?: string }>(event)
  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'action must be approve or reject.' })
  }

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, title, public_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; title: string; public_id: string } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list.' })
  }

  const row = db.prepare(
    `SELECT id, name, status, submitted_by FROM custom_list_pending WHERE id = ? AND list_id = ?`,
  ).get(pendingId, list.id) as
    { id: number; name: string; status: string; submitted_by: number | null } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Suggestion not found' })
  if (row.status !== 'pending') {
    throw createError({ statusCode: 400, statusMessage: 'That suggestion has already been decided.' })
  }

  const reason = String(body?.reason ?? '').trim().slice(0, 500) || null

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE custom_list_pending
          SET status = ?, reject_reason = ?, decided_by = ?, decided_at = datetime('now')
        WHERE id = ?`,
    ).run(action === 'approve' ? 'approved' : 'rejected', action === 'reject' ? reason : null, account.id, pendingId)

    if (action === 'approve') appendApprovedLevel(db, list.id, pendingId, account.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  if (row.submitted_by && row.submitted_by !== account.id) {
    sendInboxMessage(db, row.submitted_by, {
      kind: 'custom_list_submission',
      subject: action === 'approve'
        ? `Your suggestion was added to "${list.title}"`
        : `Your suggestion for "${list.title}" was declined`,
      body: row.name + (action === 'reject' && reason ? `\n\nReason: ${reason}` : ''),
      sent_by: account.id,
      related_kind: 'custom_list',
      related_id: list.id,
    })
  }

  if (action === 'approve') {
    notifyListWebhooks(db, list.id, 'changes', {
      title: `${row.name} added to ${list.title}`,
      description: `Approved by ${account.username}.`,
    }).catch(() => {})
  }

  return { ok: true, status: action === 'approve' ? 'approved' : 'rejected' }
})

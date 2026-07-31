import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canAdministerList, loadEditors } from '~/server/utils/custom-list-perms'
import { sendInboxMessage } from '~/server/utils/inbox'

const MAX_EDITORS = 20

/** Add an editor by username. Owner (or site admin) only. */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{ username?: string }>(event)
  const username = String(body?.username ?? '').trim()
  if (!username) throw createError({ statusCode: 400, statusMessage: 'A username is required.' })

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, title FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; title: string } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canAdministerList(list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Only the list owner can manage editors.' })
  }

  const target = db.prepare(
    `SELECT id, username FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as { id: number; username: string } | undefined
  if (!target) throw createError({ statusCode: 404, statusMessage: `No user called "${username}".` })
  if (target.id === list.owner_account_id) {
    throw createError({ statusCode: 400, statusMessage: 'The owner already has full access.' })
  }

  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM custom_list_editors WHERE list_id = ?`,
  ).get(list.id) as { n: number }).n
  if (count >= MAX_EDITORS) {
    throw createError({ statusCode: 400, statusMessage: `A list can have at most ${MAX_EDITORS} editors.` })
  }

  const added = db.prepare(
    `INSERT OR IGNORE INTO custom_list_editors (list_id, account_id, added_by) VALUES (?,?,?)`,
  ).run(list.id, target.id, account.id).changes > 0

  if (added) {
    sendInboxMessage(db, target.id, {
      kind: 'custom_list_editor',
      subject: `You can now edit "${list.title}"`,
      body: `${account.username} added you as an editor. You can change the list's levels and settings, and review records submitted to it.`,
      sent_by: account.id,
      related_kind: 'custom_list',
      related_id: list.id,
    })
  }

  return { ok: true, added, editors: loadEditors(db, list.id) }
})

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { sendInboxMessage } from '~/server/utils/inbox'
import { notifyListWebhooks } from '~/server/utils/custom-list-webhooks'
import { appendApprovedLevel } from '~/server/utils/custom-list-pending'

/**
 * Suggest a level for a custom list. Editors' own suggestions skip the queue —
 * they could add the level directly anyway, so making them approve themselves
 * would be ceremony.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{
    level_id?: number
    name?: string
    gd_id?: number
    creator?: string
    verifier?: string
    verification_url?: string
    suggested_rank?: number
    note?: string
  }>(event)

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, is_public, accepts_submissions, title
       FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as
    { id: number; owner_account_id: number; is_public: number; accepts_submissions: number; title: string } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const isEditor = canEditList(db, list, account)
  if (!list.is_public && !isEditor) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }
  if (!list.accepts_submissions && !isEditor) {
    throw createError({ statusCode: 400, statusMessage: 'This list is not taking level suggestions.' })
  }

  // A linked ALL level fills its own details in, so a suggestion can be just an id.
  const levelId = Number(body?.level_id)
  const linked = Number.isInteger(levelId) && levelId > 0
    ? db.prepare(`SELECT id, name, gd_id, creator, verification_url FROM levels WHERE id = ?`).get(levelId) as any
    : undefined

  const name = String(linked?.name ?? body?.name ?? '').trim().slice(0, 200)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'A level name is required.' })

  const already = db.prepare(
    `SELECT 1 FROM custom_list_items
      WHERE list_id = ? AND (LOWER(name) = LOWER(?) OR LOWER(ov_name) = LOWER(?))`,
  ).get(list.id, name, name)
  if (already) throw createError({ statusCode: 400, statusMessage: `${name} is already on this list.` })

  const dupe = db.prepare(
    `SELECT 1 FROM custom_list_pending
      WHERE list_id = ? AND status = 'pending' AND LOWER(name) = LOWER(?)`,
  ).get(list.id, name)
  if (dupe) throw createError({ statusCode: 400, statusMessage: `${name} has already been suggested.` })

  const rank = Number(body?.suggested_rank)
  const info = db.prepare(
    `INSERT INTO custom_list_pending
       (list_id, level_id, name, gd_id, creator, verifier, verification_url,
        suggested_rank, note, status, submitted_by, decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    list.id,
    linked?.id ?? null,
    name,
    linked?.gd_id ?? (Number.isInteger(Number(body?.gd_id)) ? Number(body?.gd_id) : null),
    linked?.creator ?? (String(body?.creator ?? '').trim().slice(0, 200) || null),
    String(body?.verifier ?? '').trim().slice(0, 200) || null,
    linked?.verification_url ?? (String(body?.verification_url ?? '').trim().slice(0, 500) || null),
    Number.isInteger(rank) && rank > 0 ? rank : null,
    String(body?.note ?? '').trim().slice(0, 500) || null,
    isEditor ? 'approved' : 'pending',
    account.id,
    isEditor ? account.id : null,
    isEditor ? new Date().toISOString() : null,
  )

  if (isEditor) {
    appendApprovedLevel(db, list.id, Number(info.lastInsertRowid), account.id)
  } else {
    sendInboxMessage(db, list.owner_account_id, {
      kind: 'custom_list_submission',
      subject: `${account.username} suggested a level for "${list.title}"`,
      body: name,
      sent_by: account.id,
      related_kind: 'custom_list',
      related_id: list.id,
    })
    notifyListWebhooks(db, list.id, 'submissions', {
      title: `Level suggested for ${list.title}`,
      description: `**${name}** — suggested by ${account.username}`,
    }).catch(() => {})
  }

  return { ok: true, status: isEditor ? 'approved' : 'pending' }
})

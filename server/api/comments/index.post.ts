import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { assertClean } from '~/server/utils/profanity-guard'

const VALID_KINDS = new Set(['profile', 'progress', 'open_verification', 'level'])
const MAX_BODY = 1000

function ownerOf(
  db: ReturnType<typeof getDb>,
  kind: string,
  targetId: number,
): { account_id: number; label: string } | null {
  if (kind === 'profile') {
    const row = db.prepare(`SELECT id FROM accounts WHERE id = ?`).get(targetId) as { id: number } | undefined
    return row ? { account_id: row.id, label: 'your profile' } : null
  }
  if (kind === 'progress') {
    const row = db.prepare(`SELECT account_id FROM progress_posts WHERE id = ?`).get(targetId) as { account_id: number } | undefined
    return row ? { account_id: row.account_id, label: 'your progress post' } : null
  }
  if (kind === 'open_verification') {
    const row = db.prepare(`SELECT submitted_by FROM open_verifications WHERE id = ?`).get(targetId) as { submitted_by: number | null } | undefined
    if (!row?.submitted_by) return null
    return { account_id: row.submitted_by, label: 'your open verification' }
  }
  if (kind === 'level') {
    // Levels have no owner to notify unless a user submitted them; sheet
    // imports have submitted_by = NULL and simply produce no inbox message.
    const row = db.prepare(`SELECT submitted_by FROM levels WHERE id = ?`).get(targetId) as { submitted_by: number | null } | undefined
    if (!row?.submitted_by) return null
    return { account_id: row.submitted_by, label: 'a level you submitted' }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody(event)
  const kind = String(body?.kind ?? '')
  const targetId = Number(body?.target_id)
  const text = String(body?.body ?? '').trim()

  if (!VALID_KINDS.has(kind) || !Number.isInteger(targetId) || targetId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'kind and target_id required.' })
  }
  if (!text) throw createError({ statusCode: 400, statusMessage: 'Comment body is required.' })
  if (text.length > MAX_BODY) {
    throw createError({ statusCode: 400, statusMessage: `Comment must be ≤${MAX_BODY} characters.` })
  }
  assertClean(text, 'Comments')

  const db = getDb()
  const result = db.prepare(
    `INSERT INTO comments (account_id, target_kind, target_id, body) VALUES (?, ?, ?, ?)`,
  ).run(me.id, kind, targetId, text)

  const commentId = Number(result.lastInsertRowid)

  // Notify the content owner (skip if they're the one commenting).
  const owner = ownerOf(db, kind, targetId)
  if (owner && owner.account_id !== me.id) {
    sendInboxMessage(db, owner.account_id, {
      kind: 'comment',
      subject: `${me.username} commented on ${owner.label}`,
      body: text.length > 200 ? text.slice(0, 200) + '…' : text,
      sent_by: me.id,
      related_kind: kind,
      related_id: commentId,
    })
  }

  return {
    id: commentId,
    account_id: me.id,
    username: me.username,
    role: me.role,
    has_avatar: me.has_avatar,
    body: text,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }
})

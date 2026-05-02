import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'

export default defineEventHandler(async (event) => {
  const me = requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const body = await readBody(event)
  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'action must be "approve" or "reject"' })
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  const db = getDb()
  const op = db.prepare(
    `SELECT id, status, list_kind, level_id, submitted_by FROM opinions WHERE id = ?`,
  ).get(id) as { id: number; status: string; list_kind: 'main'|'void'; level_id: number; submitted_by: number | null } | undefined
  if (!op || op.status !== 'pending') {
    throw createError({ statusCode: 404, statusMessage: 'No pending opinion with that id.' })
  }

  // Resolve level name for inbox messages.
  const table = op.list_kind === 'void' ? 'void_levels' : 'levels'
  const lvl = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(op.level_id) as { name: string } | undefined
  const levelName = lvl?.name ?? 'a level'

  if (action === 'approve') {
    db.prepare(
      `UPDATE opinions SET status = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
    ).run(me.id, id)
  } else {
    db.prepare(
      `UPDATE opinions SET status = 'rejected', decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
    ).run(me.id, id)
    if (op.submitted_by) {
      sendInboxMessage(db, op.submitted_by, {
        kind: 'record_rejected',
        subject: `Your opinion submission for "${levelName}" was rejected`,
        body: reason || null,
        related_kind: 'opinion',
        related_id: op.id,
        sent_by: me.id,
      })
    }
  }

  return { ok: true }
})

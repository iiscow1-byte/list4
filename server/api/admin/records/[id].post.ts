import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const me = requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })

  const body = await readBody(event)
  const action = String(body?.action ?? '')
  if (action !== 'approve' && action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'action must be "approve" or "reject"' })
  }

  const db = getDb()
  const rec = db.prepare(`SELECT id, permanent FROM records WHERE id = ?`).get(id) as { id: number; permanent: number } | undefined
  if (!rec || rec.permanent) {
    throw createError({ statusCode: 404, statusMessage: 'No pending record with that id.' })
  }

  if (action === 'approve') {
    db.prepare(
      `UPDATE records SET permanent = 1, decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
    ).run(me.id, id)
  } else {
    db.prepare(`DELETE FROM records WHERE id = ?`).run(id)
  }
  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { afterListChange, removeLevel } from '~/server/utils/list-ops'
import { logActivity } from '~/server/utils/activity-log'

/**
 * Remove a level from the list. Everything below moves up one. If the sheet
 * still lists the level, it stays off until the sheet drops it too.
 */
export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad position.' })
  }
  const body = await readBody(event).catch(() => null)
  const reason = String(body?.reason ?? '').trim().slice(0, 500) || null

  const db = getDb()
  const existing = db.prepare(`SELECT id, name FROM levels WHERE position = ?`).get(position) as { id: number; name: string } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  removeLevel(db, existing.id, me.id, { reason })
  afterListChange(db)

  logActivity({
    kind: 'level.remove',
    area: 'levels',
    severity: 'warning',
    actor: me,
    subject: { kind: 'level', id: existing.id, label: existing.name },
    summary: `Removed ${existing.name} from the list (was #${position})`,
    detail: { position, reason },
  }, db)

  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { recomputePoints } from '~/server/utils/points'
import { recordRemoval } from '~/server/utils/changes'
import { logActivity } from '~/server/utils/activity-log'

/**
 * Delete a level and shift everything below it up by one to close the gap.
 * Admin only — destructive. Non-permanent levels may be re-added on the next
 * sheet import; promote first if the deletion needs to stick.
 */
export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad position.' })
  }

  // Optional, and there is nowhere else to put it: once the level is gone the
  // only account of why it went is the one written here.
  const body = await readBody(event).catch(() => null)
  const reason = String(body?.reason ?? '').trim().slice(0, 500) || null

  const db = getDb()
  const existing = db.prepare(
    `SELECT id, name FROM levels WHERE position = ?`,
  ).get(position) as { id: number; name: string } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  db.exec('BEGIN')
  try {
    // Before the DELETE, and inside the transaction: this reads the row it is
    // preserving, and a rollback must take the record of the removal with it.
    recordRemoval(db, existing.id, me.id, reason)
    db.prepare(`DELETE FROM levels WHERE position = ?`).run(position)
    db.prepare(`UPDATE levels SET position = -(position - 1) WHERE position > ?`).run(position)
    db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  logActivity({
    kind: 'level.remove',
    area: 'levels',
    severity: 'warning',
    actor: me,
    subject: { kind: 'level', id: existing.id, label: existing.name },
    summary: `Removed ${existing.name} from the list (was #${position})`,
    detail: { position, reason },
  }, db)

  recomputePoints(db)

  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Ban or unban an account by username.
 * Body: { username: string, action: 'ban' | 'unban', reason?: string }
 *
 * Banning sets accounts.banned_at and revokes every session the user has, so
 * they're signed out everywhere immediately. Unbanning clears banned_at.
 */
export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const action = String(body?.action ?? '')
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  if (action !== 'ban' && action !== 'unban') {
    throw createError({ statusCode: 400, statusMessage: 'action must be "ban" or "unban"' })
  }

  const db = getDb()
  const target = db.prepare(
    `SELECT id, username, role FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as { id: number; username: string; role: string } | undefined
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No such user.' })
  if (target.id === me.id) {
    throw createError({ statusCode: 400, statusMessage: "You can't ban your own account." })
  }
  if ((target.role === 'admin' || target.role === 'owner' || target.role === 'developer') && action === 'ban') {
    throw createError({ statusCode: 400, statusMessage: 'Demote the admin before banning.' })
  }

  if (action === 'ban') {
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE accounts SET banned_at = datetime('now'), banned_reason = ? WHERE id = ?`,
      ).run(reason || null, target.id)
      db.prepare(`DELETE FROM sessions WHERE account_id = ?`).run(target.id)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } else {
    db.prepare(
      `UPDATE accounts SET banned_at = NULL, banned_reason = NULL WHERE id = ?`,
    ).run(target.id)
  }
  return { ok: true, username: target.username, banned: action === 'ban' }
})

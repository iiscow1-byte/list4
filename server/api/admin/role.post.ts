import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

const ROLES = new Set(['user', 'moderator', 'admin', 'owner', 'developer'])
const ADMIN_LEVEL_ROLES = new Set(['admin', 'owner', 'developer'])

export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const role = String(body?.role ?? '')
  if (!ROLES.has(role)) {
    throw createError({ statusCode: 400, statusMessage: 'Role must be user, moderator, admin, owner, or developer.' })
  }

  const db = getDb()
  const target = db.prepare(`SELECT id, username FROM accounts WHERE username = ? COLLATE NOCASE`).get(username) as any
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No such user.' })
  if (target.id === me.id && !ADMIN_LEVEL_ROLES.has(role)) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot demote yourself.' })
  }

  db.prepare(`UPDATE accounts SET role = ? WHERE id = ?`).run(role, target.id)
  return { ok: true, username: target.username, role }
})

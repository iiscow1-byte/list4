import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'

const ROLES = new Set(['user', 'moderator', 'admin', 'owner', 'developer'])
const ADMIN_LEVEL_ROLES = new Set(['admin', 'owner', 'developer'])

const ROLE_RANK: Record<string, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
  developer: 3,
}

export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const role = String(body?.role ?? '')
  if (!ROLES.has(role)) {
    throw createError({ statusCode: 400, statusMessage: 'Role must be user, moderator, admin, owner, or developer.' })
  }

  const myRank = ROLE_RANK[me.role] ?? 0
  if ((ROLE_RANK[role] ?? 0) > myRank) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot assign a role ranked above your own.' })
  }

  const db = getDb()
  const target = db.prepare(
    `SELECT id, username, role AS current_role FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as { id: number; username: string; current_role: string } | undefined
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No such user.' })
  if (target.id === me.id && !ADMIN_LEVEL_ROLES.has(role)) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot demote yourself.' })
  }

  const oldRole = target.current_role
  if (oldRole === role) return { ok: true, username: target.username, role }

  db.prepare(`UPDATE accounts SET role = ? WHERE id = ?`).run(role, target.id)

  sendInboxMessage(db, target.id, {
    kind: 'role_changed',
    subject: `Your role has been changed to ${role}`,
    body: `Your account role was updated from ${oldRole} to ${role}.`,
    sent_by: me.id,
  })

  return { ok: true, username: target.username, role }
})

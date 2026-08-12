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

  /**
   * …and everyone else who can hand out roles.
   *
   * A role change is the one action on this site that changes who can change
   * the site, and until now the only person told about it was the person it
   * happened to. An admin had no way to notice that another admin had promoted
   * somebody, short of watching the user list.
   *
   * Sent to admins and above rather than to every moderator: the notice is
   * about who holds power, and it is the people who can grant it who need to
   * see it. The actor is skipped (they just did it) and so is the target (they
   * have their own, better-worded message above).
   */
  const staff = db.prepare(
    `SELECT id FROM accounts
      WHERE role IN ('admin', 'owner', 'developer')
        AND banned_at IS NULL
        AND id NOT IN (?, ?)`,
  ).all(me.id, target.id) as { id: number }[]

  const direction = (ROLE_RANK[role] ?? 0) > (ROLE_RANK[oldRole] ?? 0) ? 'promoted' : 'changed'
  for (const s of staff) {
    sendInboxMessage(db, s.id, {
      kind: 'staff',
      subject: `${target.username} was ${direction} to ${role}`,
      body: `${me.username} changed ${target.username}'s role from ${oldRole} to ${role}.`,
      sent_by: me.id,
    })
  }

  return { ok: true, username: target.username, role, notified: staff.length }
})

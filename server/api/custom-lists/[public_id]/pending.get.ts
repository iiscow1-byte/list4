import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'

/** Suggested levels for a list. Non-editors only ever see their own. */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const status = String(getQuery(event).status ?? 'pending')
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid status.' })
  }

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, is_public FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; is_public: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const me = getCurrentAccount(event)
  const canModerate = canEditList(db, list, me)
  if (!list.is_public && !canModerate) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }

  const rows = db.prepare(
    `SELECT p.id, p.level_id, p.name, p.gd_id, p.creator, p.verifier, p.verification_url,
            p.suggested_rank, p.note, p.status, p.reject_reason, p.submitted_at,
            a.username AS submitted_by_username, p.submitted_by,
            l.position AS all_position, l.sheet_placement
       FROM custom_list_pending p
       LEFT JOIN accounts a ON a.id = p.submitted_by
       LEFT JOIN levels l ON l.id = p.level_id
      WHERE p.list_id = ? AND p.status = ?
      ORDER BY p.submitted_at DESC, p.id DESC
      LIMIT 300`,
  ).all(list.id, status) as any[]

  // Someone who can't moderate still deserves to see where their own
  // suggestion got to, but not anyone else's.
  const visible = canModerate ? rows : rows.filter((r) => me && r.submitted_by === me.id)

  const pendingCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM custom_list_pending WHERE list_id = ? AND status = 'pending'`,
  ).get(list.id) as { n: number }).n

  return {
    pending: visible.map(({ submitted_by, ...r }) => r),
    can_moderate: canModerate,
    pending_count: canModerate ? pendingCount : 0,
  }
})

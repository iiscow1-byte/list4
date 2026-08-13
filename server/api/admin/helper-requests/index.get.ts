import { getDb } from '~/server/db'
import { isAdminRole, isHelperRole, requireListStaff } from '~/server/utils/auth'
import { listHelperRequests, pendingHelperRequestCount } from '~/server/utils/helper-requests'

/**
 * The helper request queue.
 *
 * Admins see all of it, because deciding it is their job. A **helper** sees
 * their own requests and only their own — not as a privacy measure but because
 * it is the only way for them to find out what happened to something they
 * asked for. Without it, a request is a message sent into a void: they cannot
 * see the tab it lands in, and refusing one would be indistinguishable from
 * losing it.
 *
 * Moderators are not in this at all. Applying a request is an admin decision by
 * definition — the whole reason it is a request is that neither the helper nor
 * a moderator should be the one making it.
 */
export default defineEventHandler((event) => {
  const account = requireListStaff(event)
  const db = getDb()

  const q = getQuery(event)
  const status = q.status === 'applied' || q.status === 'rejected' || q.status === 'all'
    ? q.status
    : 'pending'

  if (isHelperRole(account.role)) {
    // Their own history, whatever the status: "what came of my requests" is the
    // only question this answers for them.
    const mine = listHelperRequests(db, { status: 'all', limit: 200 })
      .filter((r) => r.requested_by === account.id)
    return { items: mine, pending: mine.filter((r) => r.status === 'pending').length, mine: true }
  }

  if (!isAdminRole(account.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Admins only.' })
  }

  return {
    items: listHelperRequests(db, { status: status as never, limit: 200 }),
    pending: pendingHelperRequestCount(db),
    mine: false,
  }
})

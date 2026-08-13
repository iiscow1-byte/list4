import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'
import { assertVerified } from '~/server/utils/email-verify'
import {
  fileReport, REASONS_BY_TARGET, REPORT_TARGETS,
  type ReportReason, type ReportTarget,
} from '~/server/utils/reports'

/**
 * Report something.
 *
 * Open to any signed-in account, and signed-in is the floor rather than a
 * formality: an anonymous report cannot be followed up, cannot be rate-limited
 * meaningfully, and cannot be weighed against the reporter's history. The
 * schema's partial unique index does the rest — one *open* report per person
 * per thing, so a disagreement cannot be filed nine times.
 *
 * The reason has to be one the target can actually have. Reporting a level for
 * "impersonation" or an account for "impossible" is a category error, and
 * accepting it would leave the queue holding rows no reviewer can act on — see
 * `REASONS_BY_TARGET`.
 *
 * `staff_abuse` is accepted here like any other reason. Where it *goes* is the
 * part that matters, and that is decided at read time: only admins ever see
 * one, and never one that names them. See `visibleReportsClause`.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  assertVerified(account)
  enforceRateLimit(event, LIMITS.report)
  const body = await readBody<{
    target?: unknown; target_id?: unknown; reason?: unknown; details?: unknown
  }>(event) ?? {}

  const target = String(body.target ?? '') as ReportTarget
  if (!REPORT_TARGETS.includes(target)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown thing to report.' })
  }

  const targetId = Number(body.target_id)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Which one?' })
  }

  const reason = String(body.reason ?? '') as ReportReason
  if (!REASONS_BY_TARGET[target].includes(reason)) {
    throw createError({ statusCode: 400, statusMessage: 'That reason does not apply to this.' })
  }

  const details = typeof body.details === 'string' ? body.details : null
  // The two open-ended reasons are the ones a reviewer cannot act on without
  // being told what happened. Asking for it here beats a queue of empty rows.
  if ((reason === 'other' || reason === 'staff_abuse') && !details?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Please say what happened.' })
  }

  const db = getDb()
  const label = describeTarget(db, target, targetId)
  if (label === null) {
    throw createError({ statusCode: 404, statusMessage: 'That no longer exists.' })
  }

  // Reporting yourself is not a thing, and it is the one self-target worth
  // refusing explicitly: the rest are content, and reporting your own comment
  // is a slow way of asking for it to be deleted.
  if (target === 'account' && targetId === account.id) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot report yourself.' })
  }

  const result = fileReport(db, {
    target, targetId, targetLabel: label, reason, details, reporter: account,
  })

  if (!result.ok) {
    return { ok: true, duplicate: true, message: 'You have already reported this — it is with the moderators.' }
  }
  return { ok: true, duplicate: false, id: result.id }
})

/**
 * What the reported thing is called, resolved now rather than joined later.
 *
 * A report frequently outlives its target — the comment gets deleted, the list
 * is taken down — and a queue row reading "custom_list #412" is one a reviewer
 * cannot judge. Returning `null` means "no such thing", which is a 404 rather
 * than a report about nothing.
 */
function describeTarget(db: ReturnType<typeof getDb>, target: ReportTarget, id: number): string | null {
  const one = <T>(sql: string) => db.prepare(sql).get(id) as T | undefined
  switch (target) {
    case 'account': {
      const r = one<{ username: string }>(`SELECT username FROM accounts WHERE id = ?`)
      return r?.username ?? null
    }
    case 'comment': {
      const r = one<{ body: string }>(`SELECT body FROM comments WHERE id = ?`)
      return r ? r.body.slice(0, 120) : null
    }
    case 'custom_list': {
      const r = one<{ title: string }>(`SELECT title FROM custom_lists WHERE id = ?`)
      return r?.title ?? null
    }
    case 'level': {
      const r = one<{ name: string; position: number }>(`SELECT name, position FROM levels WHERE id = ?`)
      return r ? `#${r.position} ${r.name}` : null
    }
    case 'forum_thread': {
      const r = one<{ title: string }>(`SELECT title FROM forum_threads WHERE id = ?`)
      return r?.title ?? null
    }
    case 'forum_post': {
      const r = one<{ body: string }>(`SELECT body FROM forum_posts WHERE id = ?`)
      return r ? r.body.slice(0, 120) : null
    }
  }
}

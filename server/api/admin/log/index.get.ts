import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import {
  activityCounts, readActivity, LOG_SECTIONS,
  type LogArea, type LogSeverity,
} from '~/server/utils/activity-log'
import { undoLabel } from '~/server/utils/activity-undo'

/**
 * Read the activity log.
 *
 * Admin-only. The log names who did what, which makes it the one place on the
 * site where staff actions are attributable — including a moderator's, and
 * including an admin's. Somebody being reviewed should not be able to read the
 * record of the review.
 *
 * Every filter is optional and they compose, so one endpoint serves the
 * sections, the search box, "everything this account has done" and "everything
 * that happened to this level" without four code paths.
 */
const AREAS = new Set(LOG_SECTIONS.map((s) => s.id))
const SEVERITIES = new Set<LogSeverity>(['info', 'notable', 'warning'])

export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const q = getQuery(event)

  const area = typeof q.area === 'string' && AREAS.has(q.area as never)
    ? (q.area as LogArea | 'all')
    : 'all'
  const minSeverity = typeof q.severity === 'string' && SEVERITIES.has(q.severity as LogSeverity)
    ? (q.severity as LogSeverity)
    : 'info'

  /**
   * A window, defaulting to the last month.
   *
   * Unbounded by default would mean the counts scan the whole table on every
   * poll, and "what happened recently" is what the page is for — anything older
   * is reached by widening the range deliberately.
   */
  const days = Math.min(365, Math.max(1, Number(q.days) || 30))
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')

  const { total, items } = readActivity(db, {
    area,
    minSeverity,
    since,
    kind: typeof q.kind === 'string' && q.kind ? q.kind : undefined,
    actorId: Number(q.actor) > 0 ? Number(q.actor) : undefined,
    subjectKind: typeof q.subject_kind === 'string' && q.subject_kind ? q.subject_kind : undefined,
    subjectId: Number(q.subject_id) > 0 ? Number(q.subject_id) : undefined,
    search: typeof q.q === 'string' ? q.q : undefined,
    limit: Number(q.limit) || 60,
    offset: Number(q.offset) || 0,
  })

  return {
    total,
    // `undo` is decided here rather than in the client so the button and the
    // endpoint can never disagree about what is reversible — the registry in
    // `activity-undo.ts` is the single answer to that question.
    items: items.map((r) => ({ ...r, undo: r.undone_at ? null : undoLabel(r) })),
    // Counts follow the same severity floor and window as the rows, so a tab
    // reading 400 can't open onto twelve.
    counts: activityCounts(db, { minSeverity, since }),
    sections: LOG_SECTIONS,
  }
})

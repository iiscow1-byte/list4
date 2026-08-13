import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '~/server/db'
import type { Account } from './auth'

/**
 * Writing to the log of what happened to the list.
 *
 * The admin panel has always been able to answer "what is waiting for me?" —
 * there is a queue per kind of submission. It could not answer "what
 * happened?", which is the question you ask when something is *wrong*: who
 * moved that level, who approved that record, who changed that role, when did
 * this level stop being a challenge. Some of those facts were recoverable from
 * the row the change landed on, most were not, and none of them were in one
 * place or in one order.
 *
 * ## The shape
 *
 * One append-only row per action, written by the endpoint that performs it,
 * inside the same request. Never inside the same transaction, though — see
 * `logActivity` — because a log write that can roll back the thing it is
 * describing is worse than no log.
 *
 * `kind` is a dotted path: `level.move`, `record.approve`, `report.resolve`.
 * A section of the log is then a prefix, so adding an event never means
 * updating a list somewhere else to know it exists. `area` is the coarse bucket
 * the page's sections are built from, and is indexed.
 */

export type LogArea =
  | 'levels'
  | 'records'
  | 'accounts'
  | 'reports'
  | 'lists'
  | 'moderation'
  | 'system'

/**
 * How much attention a row deserves.
 *
 * `info` is the ordinary run of work. `notable` is something a reviewer would
 * want to find later — a placement changed by hand, a submission rejected.
 * `warning` is for the things that should never pass unnoticed: a ban, a role
 * change, a report about staff. The log page defaults to hiding `info`, because
 * a page where everything is important is a page where nothing is.
 */
export type LogSeverity = 'info' | 'notable' | 'warning'

export type LogEntry = {
  kind: string
  area: LogArea
  summary: string
  severity?: LogSeverity
  actor?: Pick<Account, 'id' | 'username' | 'role'> | null
  subject?: { kind: string; id?: number | null; label?: string | null } | null
  /** Anything worth reading later but never filtered on. Serialised as JSON. */
  detail?: Record<string, unknown> | null
}

/**
 * Append one entry.
 *
 * Swallows its own failures on purpose, and this is the one place in the file
 * worth being explicit about: the log exists to describe actions, and an action
 * that succeeded must not be reported as failed because the description of it
 * couldn't be written. The alternative — letting this throw — turns a full disk
 * into "no moderator can approve anything".
 *
 * The actor's name and role are copied in rather than joined at read time. The
 * log outlives accounts: a row saying "someone deleted this level" is close to
 * useless, and `ON DELETE SET NULL` on the id is exactly what produces it.
 */
export function logActivity(entry: LogEntry, db: DatabaseSync = getDb()): void {
  try {
    db.prepare(
      `INSERT INTO activity_log
         (kind, area, actor_id, actor_name, actor_role,
          subject_kind, subject_id, subject_label, summary, detail, severity)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      entry.kind,
      entry.area,
      entry.actor?.id ?? null,
      entry.actor?.username ?? null,
      entry.actor?.role ?? null,
      entry.subject?.kind ?? null,
      entry.subject?.id ?? null,
      entry.subject?.label != null ? String(entry.subject.label).slice(0, 300) : null,
      entry.summary.slice(0, 500),
      entry.detail ? JSON.stringify(entry.detail).slice(0, 4000) : null,
      entry.severity ?? 'info',
    )
  } catch { /* a log is never worth failing the action it describes */ }
}

/**
 * The sections the admin log page is divided into.
 *
 * Defined here rather than in the page because the API filters by them and the
 * page renders them, and two lists that must agree should be one list. Each is
 * a bucket plus the question it answers — the label alone doesn't say why you
 * would open it.
 */
export const LOG_SECTIONS: {
  id: LogArea | 'all'
  label: string
  blurb: string
}[] = [
  { id: 'all',        label: 'Everything',  blurb: 'Every action, newest first.' },
  { id: 'levels',     label: 'Levels',      blurb: 'Placements, moves, edits, removals and challenge changes.' },
  { id: 'records',    label: 'Records',     blurb: 'Records accepted, rejected and deleted.' },
  { id: 'reports',    label: 'Reports',     blurb: 'What was reported, and what was done about it.' },
  { id: 'accounts',   label: 'Accounts',    blurb: 'Roles, bans, claims and account changes.' },
  { id: 'moderation', label: 'Moderation',  blurb: 'Comments, forum posts and custom lists acted on by staff.' },
  { id: 'lists',      label: 'Custom lists', blurb: 'Lists created, published and deleted.' },
  { id: 'system',     label: 'System',      blurb: 'Imports, refreshes and anything the site did to itself.' },
]

export type ActivityRow = {
  id: number
  kind: string
  area: LogArea
  actor_id: number | null
  actor_name: string | null
  actor_role: string | null
  subject_kind: string | null
  subject_id: number | null
  subject_label: string | null
  summary: string
  detail: string | null
  severity: LogSeverity
  created_at: string
}

export type ActivityQuery = {
  area?: LogArea | 'all'
  /** Exact `kind`, or a dotted prefix like `level.` — see `kind` above. */
  kind?: string
  actorId?: number
  subjectKind?: string
  subjectId?: number
  /** Lowest severity to include. `notable` hides the ordinary run of work. */
  minSeverity?: LogSeverity
  /** Matches the summary, the actor's name or the subject's label. */
  search?: string
  /** ISO date, inclusive. */
  since?: string
  limit?: number
  offset?: number
}

const SEVERITY_RANK: Record<LogSeverity, number> = { info: 0, notable: 1, warning: 2 }

/**
 * Read the log.
 *
 * Returns the page and the total, so the page can say how much it is showing
 * of what. Every filter is optional and they compose, which is what lets one
 * endpoint serve a section, a search, one person's history and one level's
 * history without four query builders.
 */
export function readActivity(
  db: DatabaseSync,
  q: ActivityQuery,
): { total: number; items: ActivityRow[] } {
  const where: string[] = []
  const params: (string | number)[] = []

  if (q.area && q.area !== 'all') { where.push(`area = ?`); params.push(q.area) }

  if (q.kind) {
    // A trailing dot means "this family" — `level.` catches `level.move`,
    // `level.place` and anything added later without listing them here.
    if (q.kind.endsWith('.')) { where.push(`kind LIKE ?`); params.push(`${q.kind}%`) }
    else { where.push(`kind = ?`); params.push(q.kind) }
  }

  if (q.actorId) { where.push(`actor_id = ?`); params.push(q.actorId) }
  if (q.subjectKind) { where.push(`subject_kind = ?`); params.push(q.subjectKind) }
  if (q.subjectId) { where.push(`subject_id = ?`); params.push(q.subjectId) }
  if (q.since) { where.push(`created_at >= ?`); params.push(q.since) }

  if (q.minSeverity && q.minSeverity !== 'info') {
    const allowed = (Object.keys(SEVERITY_RANK) as LogSeverity[])
      .filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[q.minSeverity!])
    where.push(`severity IN (${allowed.map(() => '?').join(',')})`)
    params.push(...allowed)
  }

  if (q.search?.trim()) {
    where.push(`(summary LIKE ? COLLATE NOCASE
                 OR actor_name LIKE ? COLLATE NOCASE
                 OR subject_label LIKE ? COLLATE NOCASE)`)
    const like = `%${q.search.trim()}%`
    params.push(like, like, like)
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM activity_log ${clause}`)
    .get(...params) as { n: number }).n

  const limit = Math.min(200, Math.max(1, q.limit ?? 60))
  const offset = Math.max(0, q.offset ?? 0)
  const items = db.prepare(
    `SELECT * FROM activity_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as ActivityRow[]

  return { total, items }
}

/**
 * How many entries each section holds, for the counts on the tabs.
 *
 * One grouped scan rather than one count per section. Respects the severity
 * floor so the numbers match what the section will actually show — a tab
 * reading 400 that opens onto twelve rows is a bug report waiting to happen.
 */
export function activityCounts(
  db: DatabaseSync,
  opts: { minSeverity?: LogSeverity; since?: string } = {},
): Record<string, number> {
  const where: string[] = []
  const params: (string | number)[] = []
  if (opts.since) { where.push(`created_at >= ?`); params.push(opts.since) }
  if (opts.minSeverity && opts.minSeverity !== 'info') {
    const allowed = (Object.keys(SEVERITY_RANK) as LogSeverity[])
      .filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[opts.minSeverity!])
    where.push(`severity IN (${allowed.map(() => '?').join(',')})`)
    params.push(...allowed)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = db.prepare(
    `SELECT area, COUNT(*) AS n FROM activity_log ${clause} GROUP BY area`,
  ).all(...params) as { area: string; n: number }[]

  const out: Record<string, number> = { all: 0 }
  for (const r of rows) {
    out[r.area] = r.n
    out.all += r.n
  }
  return out
}

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { assertClean } from '~/server/utils/profanity-guard'
import { clanForAccount } from '~/server/utils/clans'
import { enforceRateLimit, LIMITS } from '~/server/utils/rate-limit'
import { assertVerified } from '~/server/utils/email-verify'
import { logActivity } from '~/server/utils/activity-log'

const VALID_KINDS = new Set(['profile', 'progress', 'open_verification', 'level'])
const MAX_BODY = 1000

function ownerOf(
  db: ReturnType<typeof getDb>,
  kind: string,
  targetId: number,
): { account_id: number; label: string } | null {
  if (kind === 'profile') {
    const row = db.prepare(`SELECT id FROM accounts WHERE id = ?`).get(targetId) as { id: number } | undefined
    return row ? { account_id: row.id, label: 'your profile' } : null
  }
  if (kind === 'progress') {
    const row = db.prepare(`SELECT account_id FROM progress_posts WHERE id = ?`).get(targetId) as { account_id: number } | undefined
    return row ? { account_id: row.account_id, label: 'your progress post' } : null
  }
  if (kind === 'open_verification') {
    const row = db.prepare(`SELECT submitted_by FROM open_verifications WHERE id = ?`).get(targetId) as { submitted_by: number | null } | undefined
    if (!row?.submitted_by) return null
    return { account_id: row.submitted_by, label: 'your open verification' }
  }
  if (kind === 'level') {
    // Levels have no owner to notify unless a user submitted them; sheet
    // imports have submitted_by = NULL and simply produce no inbox message.
    const row = db.prepare(`SELECT submitted_by FROM levels WHERE id = ?`).get(targetId) as { submitted_by: number | null } | undefined
    if (!row?.submitted_by) return null
    return { account_id: row.submitted_by, label: 'a level you submitted' }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)

  /**
   * A proved address, then a rate limit, then the comment.
   *
   * In that order deliberately. Verification is the cheap structural check —
   * it makes an account cost an inbox rather than a POST — and doing it first
   * means a bot without one never reaches the rest. The two limits behind it
   * bound what a *verified* account can do: six a minute stops a flood, sixty
   * an hour stops a slow drip that would slip under it.
   */
  assertVerified(me)
  enforceRateLimit(event, LIMITS.commentBurst)
  enforceRateLimit(event, LIMITS.commentHourly)

  const body = await readBody(event)
  const kind = String(body?.kind ?? '')
  const targetId = Number(body?.target_id)
  const text = String(body?.body ?? '').trim()

  if (!VALID_KINDS.has(kind) || !Number.isInteger(targetId) || targetId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'kind and target_id required.' })
  }
  if (!text) throw createError({ statusCode: 400, statusMessage: 'Comment body is required.' })
  if (text.length > MAX_BODY) {
    throw createError({ statusCode: 400, statusMessage: `Comment must be ≤${MAX_BODY} characters.` })
  }
  assertClean(text, 'Comments')

  const db = getDb()

  /**
   * The same comment twice is a double-submitted form, not a second thought.
   *
   * Cheaper and less annoying than a limit for the commonest accidental
   * duplicate — a double click, or a retry after a slow response — and it
   * closes the gap where two requests race past the rate limiter together.
   */
  const duplicate = db.prepare(
    `SELECT id FROM comments
      WHERE account_id = ? AND target_kind = ? AND target_id = ? AND body = ?
        AND created_at > datetime('now', '-5 minutes')`,
  ).get(me.id, kind, targetId, text)
  if (duplicate) {
    throw createError({ statusCode: 409, statusMessage: 'You just posted that.' })
  }

  const result = db.prepare(
    `INSERT INTO comments (account_id, target_kind, target_id, body) VALUES (?, ?, ?, ?)`,
  ).run(me.id, kind, targetId, text)

  const commentId = Number(result.lastInsertRowid)

  /**
   * Every comment goes in the log.
   *
   * Comments are the highest-volume thing anyone can write here and the most
   * common thing to be reported, and until now they were the one kind of
   * user-generated content with no trail at all: a comment that was deleted —
   * by its author or by a moderator — left nothing behind saying it had ever
   * existed, which is exactly the case somebody investigating a report needs.
   *
   * `info`, deliberately. The log's default view hides that band, so ordinary
   * conversation does not bury the placements and role changes above it; the
   * comments are there when you filter to them or search for a name. A log
   * where everything is important is one where nothing is.
   *
   * The body is stored in `detail` rather than in the summary, capped at the
   * same 200 characters the inbox notification uses. The summary is a line in a
   * list and needs to stay one.
   */
  logActivity({
    kind: 'comment.post',
    area: 'moderation',
    severity: 'info',
    actor: me,
    // Points at the comment, so a report about one lines up with its log entry.
    subject: { kind: 'comment', id: commentId, label: text.slice(0, 120) },
    summary: `Commented on a ${kind.replace('_', ' ')}`,
    detail: {
      target_kind: kind,
      target_id: targetId,
      body: text.length > 200 ? `${text.slice(0, 200)}…` : text,
    },
  }, db)

  // Notify the content owner (skip if they're the one commenting).
  const owner = ownerOf(db, kind, targetId)
  if (owner && owner.account_id !== me.id) {
    sendInboxMessage(db, owner.account_id, {
      kind: 'comment',
      subject: `${me.username} commented on ${owner.label}`,
      body: text.length > 200 ? text.slice(0, 200) + '…' : text,
      sent_by: me.id,
      related_kind: kind,
      related_id: commentId,
    })
  }

  // Same shape as the GET, decorations included: the client pushes this row
  // straight into the list it just rendered, so anything missing here shows up
  // as your own comment losing what everyone else's has until a reload.
  return {
    id: commentId,
    account_id: me.id,
    username: me.username,
    role: me.role,
    name_emoji: me.name_emoji ?? null,
    name_badge: me.name_badge ?? null,
    name_badge_color: me.name_badge_color ?? null,
    clan: (() => {
      const c = clanForAccount(db, me.id)
      return c ? { tag: c.tag, name: c.name, color: c.color } : null
    })(),
    has_avatar: me.has_avatar,
    body: text,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }
})

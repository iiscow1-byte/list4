import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * The inbox.
 *
 * Two things beyond the messages themselves, because the inbox now contains
 * questions rather than only notices:
 *
 * - **`actionable`** on each row. A clan invite and a friend request can be
 *   answered from the inbox, and only if the invite or request is *still open*
 *   — a message about an invite that was withdrawn, or already accepted from
 *   somewhere else, must not offer an Accept button that fails. So the message
 *   is checked against the row it refers to, and the answer travels with it.
 * - **`counts`**, so the page can group without counting client-side and the
 *   header badge can distinguish "three things happened" from "three things
 *   need you".
 *
 * The two lookups are one query each over an indexed table, not one per row.
 */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const db = getDb()

  const items = db.prepare(
    `SELECT m.id, m.kind, m.subject, m.body, m.related_kind, m.related_id,
            m.read_at, m.created_at,
            a.username AS sent_by_username,
            (a.avatar_blob IS NOT NULL) AS sent_by_has_avatar
       FROM inbox_messages m
       LEFT JOIN accounts a ON a.id = m.sent_by
      WHERE m.account_id = ?
      ORDER BY m.created_at DESC
      LIMIT 200`,
  ).all(me.id) as any[]

  /** Clans that still have an open invite out to this account. */
  const openInvites = new Set((db.prepare(
    `SELECT clan_id FROM clan_invites WHERE account_id = ?`,
  ).all(me.id) as { clan_id: number }[]).map((r) => r.clan_id))

  /** Accounts whose friend request to this one is still unanswered. */
  const openRequests = new Set((db.prepare(
    `SELECT from_account_id FROM friend_requests WHERE to_account_id = ?`,
  ).all(me.id) as { from_account_id: number }[]).map((r) => r.from_account_id))

  /** Tag and name for the clans named by any invite message on this page. */
  const clanIds = [...new Set(
    items.filter((m) => m.kind === 'clan_invite' && m.related_id).map((m) => m.related_id as number),
  )]
  const clansById = new Map<number, { tag: string; name: string; color: string | null }>()
  if (clanIds.length) {
    const ph = clanIds.map(() => '?').join(',')
    for (const c of db.prepare(
      `SELECT id, tag, name, color FROM clans WHERE id IN (${ph})`,
    ).all(...clanIds) as { id: number; tag: string; name: string; color: string | null }[]) {
      clansById.set(c.id, { tag: c.tag, name: c.name, color: c.color })
    }
  }

  const shaped = items.map((m) => {
    let actionable: 'clan_invite' | 'friend_request' | null = null
    if (m.kind === 'clan_invite' && m.related_id && openInvites.has(m.related_id)) {
      actionable = 'clan_invite'
    } else if (m.kind === 'friend_request' && m.related_id && openRequests.has(m.related_id)) {
      actionable = 'friend_request'
    }
    return {
      ...m,
      sent_by_has_avatar: !!m.sent_by_has_avatar,
      actionable,
      clan: m.kind === 'clan_invite' && m.related_id ? clansById.get(m.related_id) ?? null : null,
    }
  })

  const unread = shaped.filter((m) => !m.read_at).length

  return {
    items: shaped,
    unread,
    counts: {
      total: shaped.length,
      unread,
      /** Messages waiting on an answer, not merely unread. */
      actionable: shaped.filter((m) => m.actionable).length,
    },
  }
})

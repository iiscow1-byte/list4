import type { DatabaseSync } from 'node:sqlite'

export type InboxKind =
  | 'level_rejected'
  | 'record_rejected'
  | 'awaiting_removed'
  | 'open_verification_approved'
  | 'open_verification_rejected'
  | 'role_changed'
  | 'comment'
  | 'clan'
  /**
   * Something a moderator or above should know about, sent to all of them
   * rather than to one person. The first is a role change: who did it, to
   * whom, and from what — which until now only the person themselves was told.
   */
  | 'staff'

export function sendInboxMessage(
  db: DatabaseSync,
  account_id: number,
  msg: {
    kind: InboxKind
    subject: string
    body?: string | null
    related_kind?: string | null
    related_id?: number | null
    sent_by?: number | null
  },
) {
  if (!Number.isInteger(account_id) || account_id <= 0) return
  const body = msg.body && msg.body.trim() ? msg.body.trim().slice(0, 4000) : null
  db.prepare(
    `INSERT INTO inbox_messages (account_id, kind, subject, body, related_kind, related_id, sent_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    account_id,
    msg.kind,
    msg.subject,
    body,
    msg.related_kind ?? null,
    msg.related_id ?? null,
    msg.sent_by ?? null,
  )
}

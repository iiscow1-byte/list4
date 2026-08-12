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
   * A clan asking somebody in. Separate from the general 'clan' kind because
   * this one is a *question*: the inbox offers Accept and Decline on it and
   * answers it in place, which it can only do if it knows which messages are
   * invites. `related_id` is the clan.
   */
  | 'clan_invite'
  /**
   * The two halves of a friend request. `related_id` is the other account, and
   * 'friend_request' is answerable from the inbox the same way an invite is.
   */
  | 'friend_request'
  | 'friend_accepted'
  /** Somebody replied to a forum thread you started or posted in. */
  | 'forum_reply'
  /**
   * The custom-list kinds. These were already being sent — by the editor
   * invite, the submission queue and the record queue — and were simply missing
   * from this union, so every one of those three call sites was a type error
   * and the inbox had no label for any of them.
   */
  | 'custom_list_editor'
  | 'custom_list_submission'
  | 'custom_list_record'
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

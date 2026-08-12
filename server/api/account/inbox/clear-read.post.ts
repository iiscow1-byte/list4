import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * Delete every message already read.
 *
 * Deliberately not "delete everything": the one-press bulk action in an inbox
 * should never be able to destroy something you haven't seen. Read means you
 * have looked at it, so it is the only safe thing to sweep.
 *
 * Messages still waiting on an answer are kept whatever their read state. You
 * can open a clan invite, read it, decide later, and tidy up in between without
 * losing the invitation — the message is the only place the Accept button
 * lives.
 */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const db = getDb()

  const info = db.prepare(`
    DELETE FROM inbox_messages
     WHERE account_id = ?
       AND read_at IS NOT NULL
       AND NOT (
         kind = 'clan_invite'
         AND related_id IN (SELECT clan_id FROM clan_invites WHERE account_id = ?)
       )
       AND NOT (
         kind = 'friend_request'
         AND related_id IN (SELECT from_account_id FROM friend_requests WHERE to_account_id = ?)
       )
  `).run(me.id, me.id, me.id)

  return { ok: true, deleted: Number(info.changes ?? 0) }
})

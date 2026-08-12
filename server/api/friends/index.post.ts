import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { assertClean } from '~/server/utils/profanity-guard'
import {
  sendFriendRequest, acceptFriendRequest, clearFriendRequest,
  removeFriendship, friendState,
} from '~/server/utils/friends'

/**
 * Every friend action, behind one verb.
 *
 * They are five ways of changing the same relationship between the same two
 * accounts, and every one of them wants the same lookup, the same "does this
 * account exist and is it banned" check, and the same answer afterwards — the
 * new state, so a button can redraw itself without a second request. Five
 * endpoints would be five copies of that.
 *
 * Addressed **by username**, not by account id. A friend request is something
 * you send to a person you can name, and every caller (a profile page, a search
 * result, the inbox) has the name in hand rather than an internal id.
 */
type Action = 'request' | 'accept' | 'decline' | 'cancel' | 'remove'
const ACTIONS = new Set<Action>(['request', 'accept', 'decline', 'cancel', 'remove'])

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody<{ username?: string; action?: string; message?: string }>(event) ?? {}

  const action = String(body.action ?? '') as Action
  if (!ACTIONS.has(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown action.' })
  }

  const username = String(body.username ?? '').trim()
  if (!username) throw createError({ statusCode: 400, statusMessage: 'Who?' })

  const db = getDb()
  const them = db.prepare(
    `SELECT id, username FROM accounts WHERE username = ? COLLATE NOCASE AND banned_at IS NULL`,
  ).get(username) as { id: number; username: string } | undefined
  if (!them) throw createError({ statusCode: 404, statusMessage: 'No such account.' })
  if (them.id === me.id) {
    throw createError({ statusCode: 400, statusMessage: "That's you." })
  }

  let result: string | null = null

  if (action === 'request') {
    // A note travels with the ask and lands in their inbox, so it is held to
    // the same standard as anything else somebody can send another user.
    const message = String(body.message ?? '').trim().slice(0, 300) || null
    if (message) assertClean(message, 'Friend request notes')
    result = sendFriendRequest(db, { id: me.id, username: me.username }, them.id, message).result
  } else if (action === 'accept') {
    const ok = acceptFriendRequest(db, { id: me.id, username: me.username }, them.id)
    result = ok ? 'accepted' : 'no-request'
  } else if (action === 'decline') {
    // Their request to me.
    clearFriendRequest(db, them.id, me.id)
    result = 'declined'
  } else if (action === 'cancel') {
    // My request to them.
    clearFriendRequest(db, me.id, them.id)
    result = 'cancelled'
  } else {
    removeFriendship(db, me.id, them.id)
    result = 'removed'
  }

  return { ok: true, result, state: friendState(db, me.id, them.id) }
})

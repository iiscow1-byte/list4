import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { listFriends, incomingRequests, outgoingRequests } from '~/server/utils/friends'

/**
 * Everything about the viewer's own friendships, in one call.
 *
 * The three lists are always shown together — a friends page that made you
 * click to find out whether anybody had asked you would be hiding the only part
 * that needs an answer — and they are small (capped at a few hundred rows), so
 * splitting them across three requests would buy nothing.
 *
 * Private: this is the viewer's own social graph, and nobody else's business.
 * Public friend *counts* live on the profile endpoint instead.
 */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const db = getDb()
  const incoming = incomingRequests(db, me.id)
  return {
    friends: listFriends(db, me.id),
    incoming,
    outgoing: outgoingRequests(db, me.id),
    /** What the nav badge counts. */
    pending: incoming.length,
  }
})

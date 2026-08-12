import type { DatabaseSync } from 'node:sqlite'
import { sendInboxMessage } from './inbox'

/**
 * Friendship.
 *
 * Distinct from following, and deliberately so. A follow is one-sided, needs no
 * permission, and means "show me what this person does". A friendship is
 * mutual, is agreed to, and is what the rest of the social features hang off:
 * who you can invite to a clan in one click, whose profile shows you as a
 * connection, what "mutual friends" counts.
 *
 * Folding the two together would have forced one of two bad answers — either
 * following somebody silently befriends them, or reading a public feed requires
 * their consent. Two concepts, two tables.
 *
 * ## Shape
 *
 * `friend_requests` holds one row per outstanding ask, from → to.
 * `friends` holds *both* directions of every accepted friendship, so "who are
 * A's friends" is a primary-key range scan rather than an OR across two columns
 * with a CASE to work out which end is the other person. Every write goes
 * through this file, which is what keeps the two rows in step.
 */

export const MAX_FRIENDS = 500
/** Outstanding asks one account may have out at once — a spam ceiling. */
export const MAX_OUTGOING_REQUESTS = 100

export type FriendRow = {
  account_id: number
  username: string
  role: string
  has_avatar: boolean
  country: string | null
  claimed_player: string | null
  created_at: string
  clan_tag: string | null
  clan_name: string | null
  clan_color: string | null
}

const FRIEND_SELECT = `
  SELECT a.id AS account_id, a.username, a.role, a.country, a.claimed_player,
         (a.avatar_blob IS NOT NULL) AS has_avatar,
         c.tag AS clan_tag, c.name AS clan_name, c.color AS clan_color
`

function shape(rows: any[]): FriendRow[] {
  return rows.map((r) => ({ ...r, has_avatar: !!r.has_avatar })) as FriendRow[]
}

/** Everyone this account is friends with, most recent first. */
export function listFriends(db: DatabaseSync, accountId: number): FriendRow[] {
  return shape(db.prepare(`
    ${FRIEND_SELECT}, f.created_at
      FROM friends f
      JOIN accounts a ON a.id = f.friend_id
      LEFT JOIN clan_members cm ON cm.account_id = a.id
      LEFT JOIN clans        c  ON c.id = cm.clan_id
     WHERE f.account_id = ? AND a.banned_at IS NULL
     ORDER BY f.created_at DESC
     LIMIT ${MAX_FRIENDS}
  `).all(accountId) as any[])
}

export function friendIds(db: DatabaseSync, accountId: number): Set<number> {
  return new Set((db.prepare(
    `SELECT friend_id FROM friends WHERE account_id = ?`,
  ).all(accountId) as { friend_id: number }[]).map((r) => r.friend_id))
}

export function areFriends(db: DatabaseSync, a: number, b: number): boolean {
  return !!db.prepare(
    `SELECT 1 FROM friends WHERE account_id = ? AND friend_id = ?`,
  ).get(a, b)
}

export function friendCount(db: DatabaseSync, accountId: number): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM friends WHERE account_id = ?`,
  ).get(accountId) as { n: number }).n
}

/**
 * Friends in common with somebody else.
 *
 * This is what "mutual friends" means now. It used to mean "people you both
 * follow", which is a different and much weaker claim — two strangers who both
 * follow the site's top ten players had ten "mutuals" between them.
 */
export function mutualFriends(db: DatabaseSync, a: number, b: number): FriendRow[] {
  return shape(db.prepare(`
    ${FRIEND_SELECT}, f1.created_at
      FROM friends f1
      JOIN friends f2 ON f2.friend_id = f1.friend_id AND f2.account_id = ?
      JOIN accounts a ON a.id = f1.friend_id
      LEFT JOIN clan_members cm ON cm.account_id = a.id
      LEFT JOIN clans        c  ON c.id = cm.clan_id
     WHERE f1.account_id = ? AND a.banned_at IS NULL
     ORDER BY a.username COLLATE NOCASE ASC
     LIMIT 100
  `).all(b, a) as any[])
}

export type RequestRow = FriendRow & { message: string | null }

/** Asks waiting on this account to answer. */
export function incomingRequests(db: DatabaseSync, accountId: number): RequestRow[] {
  return shape(db.prepare(`
    ${FRIEND_SELECT}, r.created_at, r.message
      FROM friend_requests r
      JOIN accounts a ON a.id = r.from_account_id
      LEFT JOIN clan_members cm ON cm.account_id = a.id
      LEFT JOIN clans        c  ON c.id = cm.clan_id
     WHERE r.to_account_id = ? AND a.banned_at IS NULL
     ORDER BY r.created_at DESC
  `).all(accountId) as any[]) as RequestRow[]
}

/** Asks this account has sent and not had answered. */
export function outgoingRequests(db: DatabaseSync, accountId: number): RequestRow[] {
  return shape(db.prepare(`
    ${FRIEND_SELECT}, r.created_at, r.message
      FROM friend_requests r
      JOIN accounts a ON a.id = r.to_account_id
      LEFT JOIN clan_members cm ON cm.account_id = a.id
      LEFT JOIN clans        c  ON c.id = cm.clan_id
     WHERE r.from_account_id = ? AND a.banned_at IS NULL
     ORDER BY r.created_at DESC
  `).all(accountId) as any[]) as RequestRow[]
}

/**
 * How this account stands with another one, in one word.
 *
 * A single call because the four states are mutually exclusive and every UI
 * that shows a friend button needs to know which one it is before it can draw
 * anything. Working it out from three separate booleans at each call site is
 * how a button ends up offering to send a request to somebody who has already
 * sent you one.
 */
export type FriendState = 'self' | 'friends' | 'incoming' | 'outgoing' | 'none'

export function friendState(db: DatabaseSync, me: number, them: number): FriendState {
  if (me === them) return 'self'
  if (areFriends(db, me, them)) return 'friends'
  if (db.prepare(`SELECT 1 FROM friend_requests WHERE from_account_id = ? AND to_account_id = ?`).get(them, me)) {
    return 'incoming'
  }
  if (db.prepare(`SELECT 1 FROM friend_requests WHERE from_account_id = ? AND to_account_id = ?`).get(me, them)) {
    return 'outgoing'
  }
  return 'none'
}

/**
 * Make two accounts friends, and clear any request between them in either
 * direction.
 *
 * Both rows and the cleanup happen together: a half-written friendship is one
 * where each person sees a different answer to "are we friends", and there is
 * no code path that could notice. The caller is expected to already be inside a
 * transaction when it has other work to do alongside.
 */
export function addFriendship(db: DatabaseSync, a: number, b: number): void {
  if (a === b) return
  db.prepare(`INSERT OR IGNORE INTO friends (account_id, friend_id) VALUES (?, ?)`).run(a, b)
  db.prepare(`INSERT OR IGNORE INTO friends (account_id, friend_id) VALUES (?, ?)`).run(b, a)
  db.prepare(
    `DELETE FROM friend_requests
      WHERE (from_account_id = ? AND to_account_id = ?)
         OR (from_account_id = ? AND to_account_id = ?)`,
  ).run(a, b, b, a)
}

/** Undo it, from either side. Removing a friend is not a negotiation. */
export function removeFriendship(db: DatabaseSync, a: number, b: number): void {
  db.prepare(
    `DELETE FROM friends
      WHERE (account_id = ? AND friend_id = ?) OR (account_id = ? AND friend_id = ?)`,
  ).run(a, b, b, a)
}

/**
 * Send a request, or accept the one already coming the other way.
 *
 * Two people who ask each other at the same moment want to be friends, and
 * making them each dismiss the other's pending request to get there would be a
 * puzzle rather than a feature. So a request that meets its mirror completes it.
 *
 * @returns what happened, so the caller can word its answer.
 */
export function sendFriendRequest(
  db: DatabaseSync,
  from: { id: number; username: string },
  toId: number,
  message: string | null,
): { result: 'sent' | 'accepted' | 'already-friends' | 'already-sent' } {
  if (from.id === toId) {
    throw createError({ statusCode: 400, statusMessage: "You can't friend yourself." })
  }
  if (areFriends(db, from.id, toId)) return { result: 'already-friends' }

  const mirrored = db.prepare(
    `SELECT 1 FROM friend_requests WHERE from_account_id = ? AND to_account_id = ?`,
  ).get(toId, from.id)
  if (mirrored) {
    acceptFriendRequest(db, { id: from.id, username: from.username }, toId)
    return { result: 'accepted' }
  }

  const existing = db.prepare(
    `SELECT 1 FROM friend_requests WHERE from_account_id = ? AND to_account_id = ?`,
  ).get(from.id, toId)
  if (existing) return { result: 'already-sent' }

  const outstanding = (db.prepare(
    `SELECT COUNT(*) AS n FROM friend_requests WHERE from_account_id = ?`,
  ).get(from.id) as { n: number }).n
  if (outstanding >= MAX_OUTGOING_REQUESTS) {
    throw createError({
      statusCode: 429,
      statusMessage: 'You have too many friend requests waiting for an answer.',
    })
  }
  if (friendCount(db, from.id) >= MAX_FRIENDS) {
    throw createError({ statusCode: 400, statusMessage: `You can have at most ${MAX_FRIENDS} friends.` })
  }

  db.prepare(
    `INSERT INTO friend_requests (from_account_id, to_account_id, message) VALUES (?,?,?)`,
  ).run(from.id, toId, message)

  // The inbox is where an ask is answered — see pages/inbox.vue. Without this a
  // request is only visible to somebody who happens to open their friends list.
  sendInboxMessage(db, toId, {
    kind: 'friend_request',
    subject: `${from.username} sent you a friend request`,
    body: message,
    related_kind: 'account',
    related_id: from.id,
    sent_by: from.id,
  })
  return { result: 'sent' }
}

/**
 * Accept the request `fromId` sent to `me`.
 *
 * Silently does nothing when there is no such request, rather than throwing:
 * the common way to hit that is answering the same inbox message twice, and an
 * error there would be reporting a problem that does not exist.
 */
export function acceptFriendRequest(
  db: DatabaseSync,
  me: { id: number; username: string },
  fromId: number,
): boolean {
  const req = db.prepare(
    `SELECT 1 FROM friend_requests WHERE from_account_id = ? AND to_account_id = ?`,
  ).get(fromId, me.id)
  const mutual = areFriends(db, me.id, fromId)
  if (!req && !mutual) return false
  if (mutual) return true

  if (friendCount(db, me.id) >= MAX_FRIENDS) {
    throw createError({ statusCode: 400, statusMessage: `You can have at most ${MAX_FRIENDS} friends.` })
  }
  addFriendship(db, me.id, fromId)

  sendInboxMessage(db, fromId, {
    kind: 'friend_accepted',
    subject: `${me.username} accepted your friend request`,
    related_kind: 'account',
    related_id: me.id,
    sent_by: me.id,
  })
  return true
}

/**
 * Turn one down, or take one back.
 *
 * Deliberately silent to the other party. Telling somebody their request was
 * declined turns "no" into a message they receive, which is the kind of thing
 * that makes people not use the feature.
 */
export function clearFriendRequest(db: DatabaseSync, fromId: number, toId: number): void {
  db.prepare(
    `DELETE FROM friend_requests WHERE from_account_id = ? AND to_account_id = ?`,
  ).run(fromId, toId)
}

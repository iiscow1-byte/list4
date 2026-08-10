import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { clanForAccount } from '~/server/utils/clans'

/**
 * Joining, leaving, and the owner's side of both.
 *
 * One endpoint for every membership change, because they share the rules that
 * matter: one clan per account, the owner can't walk out of a clan that still
 * has people in it, and only the owner may add or remove somebody else.
 *
 *   join    — join an open clan, or ask an invite-only one
 *   cancel  — withdraw a request
 *   leave   — leave the clan you are in
 *   accept  — owner: let a requester in
 *   decline — owner: turn a request down
 *   remove  — owner: remove a member
 *   transfer— owner: hand the clan to another member
 */
type Action = 'join' | 'cancel' | 'leave' | 'accept' | 'decline' | 'remove' | 'transfer'
const ACTIONS = new Set<Action>(['join', 'cancel', 'leave', 'accept', 'decline', 'remove', 'transfer'])

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const tag = String(getRouterParam(event, 'tag') ?? '').trim()
  const body = await readBody<{ action?: string; account_id?: number; message?: string }>(event) ?? {}
  const action = String(body.action ?? '') as Action
  if (!ACTIONS.has(action)) throw createError({ statusCode: 400, statusMessage: 'Unknown action.' })

  const db = getDb()
  const clan = db.prepare(`SELECT * FROM clans WHERE tag = ?`).get(tag) as any
  if (!clan) throw createError({ statusCode: 404, statusMessage: 'No such clan.' })

  const isOwner = me.id === clan.owner_account_id
  const mine = clanForAccount(db, me.id)
  const inThis = !!mine && mine.id === clan.id

  const addMember = db.prepare(
    `INSERT OR IGNORE INTO clan_members (account_id, clan_id, role) VALUES (?, ?, 'member')`,
  )
  const dropRequest = db.prepare(
    `DELETE FROM clan_join_requests WHERE clan_id = ? AND account_id = ?`,
  )

  if (action === 'join') {
    if (inThis) throw createError({ statusCode: 400, statusMessage: 'You are already in this clan.' })
    if (mine) throw createError({ statusCode: 400, statusMessage: 'Leave your current clan first.' })
    if (clan.invite_only) {
      db.prepare(
        `INSERT OR REPLACE INTO clan_join_requests (clan_id, account_id, message) VALUES (?,?,?)`,
      ).run(clan.id, me.id, String(body.message ?? '').trim().slice(0, 300) || null)
      sendInboxMessage(db, clan.owner_account_id, {
        kind: 'clan',
        subject: `${me.username} asked to join [${clan.tag}]`,
        body: String(body.message ?? '').trim().slice(0, 300) || null,
        sent_by: me.id,
      })
      return { ok: true, requested: true }
    }
    addMember.run(me.id, clan.id)
    return { ok: true, joined: true }
  }

  if (action === 'cancel') {
    dropRequest.run(clan.id, me.id)
    return { ok: true }
  }

  if (action === 'leave') {
    if (!inThis) throw createError({ statusCode: 400, statusMessage: 'You are not in this clan.' })
    if (isOwner) {
      const others = (db.prepare(
        `SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ? AND account_id != ?`,
      ).get(clan.id, me.id) as { n: number }).n
      if (others > 0) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Hand the clan to another member before leaving it.',
        })
      }
      // The last person out turns the lights off: a clan with no members is a
      // row nobody can ever join or delete.
      db.exec('BEGIN')
      try {
        db.prepare(`DELETE FROM clan_members WHERE clan_id = ?`).run(clan.id)
        db.prepare(`DELETE FROM clans WHERE id = ?`).run(clan.id)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return { ok: true, disbanded: true }
    }
    db.prepare(`DELETE FROM clan_members WHERE account_id = ? AND clan_id = ?`).run(me.id, clan.id)
    return { ok: true, left: true }
  }

  // Everything below is the owner's.
  if (!isOwner) throw createError({ statusCode: 403, statusMessage: 'Only the clan owner can do that.' })
  const targetId = Number(body.account_id)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'account_id required.' })
  }
  const target = db.prepare(`SELECT id, username FROM accounts WHERE id = ?`)
    .get(targetId) as { id: number; username: string } | undefined
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No such account.' })

  if (action === 'accept') {
    if (clanForAccount(db, targetId)) {
      dropRequest.run(clan.id, targetId)
      throw createError({ statusCode: 400, statusMessage: `${target.username} has joined another clan.` })
    }
    db.exec('BEGIN')
    try {
      addMember.run(targetId, clan.id)
      dropRequest.run(clan.id, targetId)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    sendInboxMessage(db, targetId, {
      kind: 'clan',
      subject: `You joined [${clan.tag}] ${clan.name}`,
      body: null,
      sent_by: me.id,
    })
    return { ok: true }
  }

  if (action === 'decline') {
    dropRequest.run(clan.id, targetId)
    return { ok: true }
  }

  if (action === 'remove') {
    if (targetId === clan.owner_account_id) {
      throw createError({ statusCode: 400, statusMessage: 'The owner can\'t be removed.' })
    }
    db.prepare(`DELETE FROM clan_members WHERE account_id = ? AND clan_id = ?`).run(targetId, clan.id)
    return { ok: true }
  }

  // transfer
  const targetMember = db.prepare(
    `SELECT 1 FROM clan_members WHERE account_id = ? AND clan_id = ?`,
  ).get(targetId, clan.id)
  if (!targetMember) throw createError({ statusCode: 400, statusMessage: 'They are not in this clan.' })
  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE clans SET owner_account_id = ? WHERE id = ?`).run(targetId, clan.id)
    db.prepare(`UPDATE clan_members SET role = 'member' WHERE account_id = ? AND clan_id = ?`).run(me.id, clan.id)
    db.prepare(`UPDATE clan_members SET role = 'owner' WHERE account_id = ? AND clan_id = ?`).run(targetId, clan.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  sendInboxMessage(db, targetId, {
    kind: 'clan',
    subject: `You now own [${clan.tag}] ${clan.name}`,
    body: null,
    sent_by: me.id,
  })
  return { ok: true }
})

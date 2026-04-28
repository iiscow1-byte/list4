import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  if (me.claimed_player) {
    throw createError({ statusCode: 400, statusMessage: 'You already have a claimed player.' })
  }

  const body = await readBody(event)
  const player = String(body?.player_name ?? '').trim()
  if (!player) throw createError({ statusCode: 400, statusMessage: 'player_name is required.' })

  const db = getDb()
  const exists = db.prepare(`SELECT 1 FROM players WHERE name = ? COLLATE NOCASE`).get(player)
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'No such player on the leaderboard.' })

  const taken = db.prepare(`SELECT 1 FROM accounts WHERE claimed_player = ? COLLATE NOCASE`).get(player)
  if (taken) throw createError({ statusCode: 409, statusMessage: 'That player has already been claimed.' })

  const pending = db.prepare(
    `SELECT 1 FROM claim_requests WHERE account_id = ? AND status = 'pending'`,
  ).get(me.id)
  if (pending) throw createError({ statusCode: 409, statusMessage: 'You already have a pending claim — wait for an admin to review it.' })

  db.prepare(`INSERT INTO claim_requests (account_id, player_name) VALUES (?, ?)`).run(me.id, player)
  return { ok: true }
})

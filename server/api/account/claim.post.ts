import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * Submit a claim. Three sources share the same `claim_requests` queue:
 *   - 'all'          → resolves a player_name against the local `players` table
 *   - 'aredl'        → resolves an Aredl UUID against `aredl_players`
 *   - 'pointercrate' → resolves a Pointercrate player id against `pointercrate_players`
 *
 * Discord-pairing auto-accept is intentionally not wired up yet — the discord
 * link on accounts isn't available at the time this lands.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody(event)
  const source = String(body?.source ?? 'all').toLowerCase()

  const db = getDb()
  const pending = db.prepare(
    `SELECT 1 FROM claim_requests WHERE account_id = ? AND status = 'pending'`,
  ).get(me.id)
  if (pending) {
    throw createError({ statusCode: 409, statusMessage: 'You already have a pending claim — wait for an admin to review it.' })
  }

  if (source === 'aredl') {
    if (me.claimed_aredl_uuid) {
      throw createError({ statusCode: 400, statusMessage: 'You already have a claimed AREDL player.' })
    }
    const uuid = String(body?.aredl_player_uuid ?? '').trim()
    if (!uuid) throw createError({ statusCode: 400, statusMessage: 'aredl_player_uuid is required.' })

    const player = db.prepare(
      `SELECT global_name, claimed_account_id FROM aredl_players WHERE uuid = ?`,
    ).get(uuid) as { global_name: string; claimed_account_id: number | null } | undefined
    if (!player) throw createError({ statusCode: 404, statusMessage: 'No such AREDL player.' })
    if (player.claimed_account_id) {
      throw createError({ statusCode: 409, statusMessage: 'That AREDL player has already been claimed.' })
    }

    db.prepare(
      `INSERT INTO claim_requests (account_id, player_name, source, aredl_player_uuid)
       VALUES (?, ?, 'aredl', ?)`,
    ).run(me.id, player.global_name, uuid)
    return { ok: true }
  }

  if (source === 'pointercrate') {
    if ((me as any).claimed_pointercrate_id) {
      throw createError({ statusCode: 400, statusMessage: 'You already have a claimed Pointercrate player.' })
    }
    const pcId = Number(body?.pointercrate_player_id)
    if (!Number.isFinite(pcId) || pcId <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'pointercrate_player_id is required.' })
    }

    const player = db.prepare(
      `SELECT name, claimed_account_id FROM pointercrate_players WHERE pc_id = ?`,
    ).get(pcId) as { name: string; claimed_account_id: number | null } | undefined
    if (!player) throw createError({ statusCode: 404, statusMessage: 'No such Pointercrate player.' })
    if (player.claimed_account_id) {
      throw createError({ statusCode: 409, statusMessage: 'That Pointercrate player has already been claimed.' })
    }

    db.prepare(
      `INSERT INTO claim_requests (account_id, player_name, source, pointercrate_player_id)
       VALUES (?, ?, 'pointercrate', ?)`,
    ).run(me.id, player.name, pcId)
    return { ok: true }
  }

  // Legacy ALL claim
  if (me.claimed_player) {
    throw createError({ statusCode: 400, statusMessage: 'You already have a claimed player.' })
  }
  const playerName = String(body?.player_name ?? '').trim()
  if (!playerName) throw createError({ statusCode: 400, statusMessage: 'player_name is required.' })

  const exists = db.prepare(`SELECT 1 FROM players WHERE name = ? COLLATE NOCASE`).get(playerName)
  if (!exists) throw createError({ statusCode: 404, statusMessage: 'No such player on the leaderboard.' })

  const taken = db.prepare(`SELECT 1 FROM accounts WHERE claimed_player = ? COLLATE NOCASE`).get(playerName)
  if (taken) throw createError({ statusCode: 409, statusMessage: 'That player has already been claimed.' })

  db.prepare(
    `INSERT INTO claim_requests (account_id, player_name, source) VALUES (?, ?, 'all')`,
  ).run(me.id, playerName)
  return { ok: true }
})

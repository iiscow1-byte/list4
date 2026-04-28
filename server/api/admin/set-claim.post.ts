import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Admin-only direct-claim: bind a player name to an account without going through
 * the user-initiated claim queue. Used to "help people claim empty accounts."
 * Pass `player_name: null` (or omit) to clear an existing claim.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const rawPlayer = body?.player_name
  const player = rawPlayer == null || rawPlayer === '' ? null : String(rawPlayer).trim()

  const db = getDb()
  const target = db.prepare(`SELECT id FROM accounts WHERE username = ? COLLATE NOCASE`).get(username) as { id: number } | undefined
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No such user.' })

  if (player) {
    const exists = db.prepare(`SELECT 1 FROM players WHERE name = ? COLLATE NOCASE`).get(player)
    if (!exists) throw createError({ statusCode: 404, statusMessage: 'No such player on the leaderboard.' })
    const taken = db.prepare(
      `SELECT 1 FROM accounts WHERE claimed_player = ? COLLATE NOCASE AND id != ?`,
    ).get(player, target.id)
    if (taken) throw createError({ statusCode: 409, statusMessage: 'That player is already claimed by another account.' })
  }

  db.prepare(`UPDATE accounts SET claimed_player = ? WHERE id = ?`).run(player, target.id)
  // Cancel any outstanding pending claim for this account.
  db.prepare(`DELETE FROM claim_requests WHERE account_id = ? AND status = 'pending'`).run(target.id)
  return { ok: true, claimed_player: player }
})

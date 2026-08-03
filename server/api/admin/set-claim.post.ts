import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { renameClaimedRecords } from '~/server/utils/claim-records'
import { unclaim, isClaimKind, CLAIM_KIND_LABELS } from '~/server/utils/unclaim'
import { invalidateLeaderboardCache } from '~/server/api/leaderboard.get'

/**
 * Admin-only direct-claim: bind a player name to an account without going through
 * the user-initiated claim queue. Used to "help people claim empty accounts."
 * Pass `player_name: null` (or omit) to clear an existing claim.
 *
 * Pass `unclaim: 'aredl' | 'gdl' | 'pointercrate' | 'player'` instead to release
 * a claim someone already holds — the same operation the account owner can do
 * for themselves, available to an admin for the cases where they can't (a lost
 * account, a claim approved by mistake, a player disputing one).
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

  if (body?.unclaim != null && body.unclaim !== '') {
    if (!isClaimKind(body.unclaim)) {
      throw createError({ statusCode: 400, statusMessage: 'Unknown claim type.' })
    }
    const result = unclaim(db, target.id, body.unclaim)
    if (!result.released) {
      throw createError({
        statusCode: 400,
        statusMessage: `${username} hasn't claimed ${CLAIM_KIND_LABELS[body.unclaim]}.`,
      })
    }
    invalidateLeaderboardCache()
    return { ok: true, ...result }
  }

  if (player) {
    const exists = db.prepare(`SELECT 1 FROM players WHERE name = ? COLLATE NOCASE`).get(player)
    if (!exists) throw createError({ statusCode: 404, statusMessage: 'No such player on the leaderboard.' })
    const taken = db.prepare(
      `SELECT 1 FROM accounts WHERE claimed_player = ? COLLATE NOCASE AND id != ?`,
    ).get(player, target.id)
    if (taken) throw createError({ statusCode: 409, statusMessage: 'That player is already claimed by another account.' })
  }

  db.prepare(`UPDATE accounts SET claimed_player = ? WHERE id = ?`).run(player, target.id)
  // The profile reads under the claimed name when there is one, so records
  // brought in by an external claim move with it — otherwise setting a name
  // here would hide records the account already holds.
  const account = db.prepare(`SELECT username FROM accounts WHERE id = ?`)
    .get(target.id) as { username: string }
  renameClaimedRecords(db, target.id, player ?? account.username)
  // Cancel any outstanding pending claim for this account.
  db.prepare(`DELETE FROM claim_requests WHERE account_id = ? AND status = 'pending'`).run(target.id)
  invalidateLeaderboardCache()
  return { ok: true, claimed_player: player }
})

import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { clanForAccount, clanLeaderboard } from '~/server/utils/clans'

/**
 * The clan leaderboard, and which clan the viewer is in.
 *
 * Public: a clan's standing is the point of having one. `mine` is what lets the
 * page offer "leave" instead of "join" without a second request.
 */
export default defineEventHandler((event) => {
  const db = getDb()
  const me = getCurrentAccount(event)
  return {
    clans: clanLeaderboard(db),
    mine: me ? clanForAccount(db, me.id) ?? null : null,
    signedIn: !!me,
  }
})

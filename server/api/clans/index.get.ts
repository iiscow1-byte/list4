import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { clanForAccount, clanLeaderboard, invitesForAccount } from '~/server/utils/clans'

/**
 * The clan leaderboard, and which clan the viewer is in.
 *
 * Public: a clan's standing is the point of having one. `mine` is what lets the
 * page offer "leave" instead of "join" without a second request.
 *
 * `invites` is here rather than only on each clan's page because an invite is
 * useless if you have to already be looking at the clan to find it. It arrives
 * as an inbox message too; this is the copy you can act on.
 */
export default defineEventHandler((event) => {
  const db = getDb()
  const me = getCurrentAccount(event)
  return {
    clans: clanLeaderboard(db),
    mine: me ? clanForAccount(db, me.id) ?? null : null,
    invites: me ? invitesForAccount(db, me.id) : [],
    signedIn: !!me,
  }
})

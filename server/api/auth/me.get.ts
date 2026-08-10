import { getCurrentAccount } from '~/server/utils/auth'
import { ADMIN_ONLY, SIGNUPS_ENABLED, isStaff } from '~/server/utils/site-access'
import { getDb } from '~/server/db'
import { clanForAccount } from '~/server/utils/clans'

/**
 * The current session, plus the site's access policy.
 *
 * The policy rides along here rather than being baked into the client bundle so
 * there is exactly one authority on who gets in: `canAccess` is the server's own
 * verdict on this request's session, so the route middleware can never disagree
 * with the server middleware about a given user.
 *
 * The clan is attached here rather than inside `getCurrentAccount` on purpose.
 * That function's return type is what every write path binds its parameters
 * from, and a field that exists only to be printed has no business travelling
 * through an UPDATE. This is the read side, so it belongs on this side.
 */
export default defineEventHandler((event) => {
  const account = getCurrentAccount(event)
  const clan = account ? clanForAccount(getDb(), account.id) : undefined

  return {
    account: account
      ? {
          ...account,
          clan: clan ? { tag: clan.tag, name: clan.name, color: clan.color } : null,
          clan_role: clan?.role ?? null,
        }
      : null,
    site: {
      adminOnly: ADMIN_ONLY,
      signupsEnabled: SIGNUPS_ENABLED,
      canAccess: !ADMIN_ONLY || isStaff(account),
    },
  }
})

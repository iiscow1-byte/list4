import { getCurrentAccount } from '~/server/utils/auth'
import { ADMIN_ONLY, SIGNUPS_ENABLED, isStaff } from '~/server/utils/site-access'

/**
 * The current session, plus the site's access policy.
 *
 * The policy rides along here rather than being baked into the client bundle so
 * there is exactly one authority on who gets in: `canAccess` is the server's own
 * verdict on this request's session, so the route middleware can never disagree
 * with the server middleware about a given user.
 */
export default defineEventHandler((event) => {
  const account = getCurrentAccount(event)
  return {
    account,
    site: {
      adminOnly: ADMIN_ONLY,
      signupsEnabled: SIGNUPS_ENABLED,
      canAccess: !ADMIN_ONLY || isStaff(account),
    },
  }
})

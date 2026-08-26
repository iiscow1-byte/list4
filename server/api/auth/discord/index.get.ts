import { discordConfig, issueState, authorizeUrl, safeReturnTo } from '~/server/utils/discord-oauth'
import { enforceRateLimit, ipSubject, LIMITS } from '~/server/utils/rate-limit'

/**
 * Start the Discord sign-in. Redirects to Discord's consent screen.
 *
 * Rate limited on the way in as well as the way back: this endpoint sets a
 * cookie and issues a redirect, both cheap, but an unbounded one is still a
 * free way to make this server originate traffic at Discord.
 */
export default defineEventHandler((event) => {
  const cfg = discordConfig()
  if (!cfg) {
    throw createError({ statusCode: 503, statusMessage: 'Discord sign-in is not configured on this server.' })
  }
  enforceRateLimit(event, LIMITS.discordOauth, ipSubject(event))

  const returnTo = safeReturnTo(getQuery(event).return_to)
  const state = issueState(event, returnTo)
  return sendRedirect(event, authorizeUrl(cfg, state), 302)
})

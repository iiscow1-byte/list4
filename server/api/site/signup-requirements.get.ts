import { mailEnabled } from '~/server/utils/mail'
import { discordConfig } from '~/server/utils/discord-oauth'

/**
 * What the sign-up form has to collect.
 *
 * An email address is required only when the server can actually send to one —
 * otherwise the form would demand an address that could never be verified and
 * refuse to proceed on a check that can never pass. The signup endpoint applies
 * the same rule; this exists so the form agrees with it instead of guessing.
 */
export default defineEventHandler(() => {
  const discord = discordConfig()
  return {
    emailRequired: mailEnabled(),
    /**
     * Whether to offer the Discord button at all. A button that leads to a 503
     * is worse than no button, so the forms ask rather than assume.
     *
     * The invite link is included so somebody who isn't in the server can be
     * told where to go instead of only being told no. No secret is exposed —
     * the client id is public by design and isn't sent here anyway.
     */
    discordEnabled: discord !== null,
    discordInviteUrl: discord?.inviteUrl ?? null,
  }
})

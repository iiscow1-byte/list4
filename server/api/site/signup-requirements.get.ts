import { mailEnabled } from '~/server/utils/mail'
import { discordConfig } from '~/server/utils/discord-oauth'

/**
 * What the sign-up page can offer.
 *
 * Accounts are made through Discord only, so `discordEnabled` is the question
 * that decides whether the page has anything to show at all. `emailRequired`
 * stays because the account settings page still asks for an address — it is
 * just no longer part of creating one.
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

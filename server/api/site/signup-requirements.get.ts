import { mailEnabled } from '~/server/utils/mail'

/**
 * What the sign-up form has to collect.
 *
 * An email address is required only when the server can actually send to one —
 * otherwise the form would demand an address that could never be verified and
 * refuse to proceed on a check that can never pass. The signup endpoint applies
 * the same rule; this exists so the form agrees with it instead of guessing.
 */
export default defineEventHandler(() => ({
  emailRequired: mailEnabled(),
}))

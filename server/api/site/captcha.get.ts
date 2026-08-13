import { captchaEnabled, captchaProvider, publicSiteKey } from '~/server/utils/captcha'

/**
 * What the sign-up and sign-in forms need to render a captcha, if any.
 *
 * Public — a site key is public by definition, it is embedded in the widget on
 * every page that shows one. The *secret* never leaves the server.
 *
 * Served rather than baked into the bundle so rotating a key is an environment
 * change and a restart, not a rebuild and a redeploy. It also lets the form ask
 * "is this even on?" and skip loading a third-party script when it isn't.
 */
export default defineEventHandler(() => ({
  enabled: captchaEnabled(),
  provider: captchaProvider(),
  siteKey: publicSiteKey(),
}))

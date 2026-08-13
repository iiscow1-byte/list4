/**
 * Captcha verification for the two endpoints that hand out or unlock accounts.
 *
 * ## Which provider
 *
 * Cloudflare Turnstile and hCaptcha are both supported, because their verify
 * calls are the same shape — POST a secret and a token, read `success` — and
 * supporting the second cost three lines. Turnstile is the better default: it
 * is free at any volume and usually invisible, so the common case is a
 * checkbox nobody has to solve.
 *
 * reCAPTCHA is deliberately absent. Its v3 mode returns a *score* rather than a
 * verdict, which means picking a threshold and silently turning away some
 * proportion of real people with no way for them to appeal — a worse trade than
 * a visible checkbox on a page you visit once.
 *
 * ## What it is and is not for
 *
 * It raises the cost of *bulk automated* signups. It does not stop a determined
 * human, or a solver farm, and it is not the only thing here that shouldn't be:
 * signup is also rate limited per address, and an account cannot post anything
 * until an email has been confirmed. Captcha is the cheapest of those three and
 * the easiest to defeat; it is worth having as the outer layer and worth
 * nothing on its own.
 *
 * ## When it is not configured
 *
 * `captchaEnabled()` is false and verification is skipped. Same reasoning as
 * the mailer: a deployment that has not set a key must not become one nobody
 * can sign up to, and during development a mandatory third-party round trip is
 * pure friction. The signup endpoint reports which state it is in so the form
 * can render the widget only when it will actually be checked.
 */
type Provider = 'turnstile' | 'hcaptcha'

const ENDPOINTS: Record<Provider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://hcaptcha.com/siteverify',
}

function provider(): Provider | null {
  if (process.env.TURNSTILE_SECRET_KEY) return 'turnstile'
  if (process.env.HCAPTCHA_SECRET) return 'hcaptcha'
  return null
}

function secret(which: Provider): string {
  return (which === 'turnstile'
    ? process.env.TURNSTILE_SECRET_KEY
    : process.env.HCAPTCHA_SECRET) ?? ''
}

/** Whether a token will actually be demanded and checked. */
export function captchaEnabled(): boolean {
  return provider() !== null && !!publicSiteKey()
}

/**
 * The key the widget needs, which is public by design.
 *
 * Served to the browser by `/api/site/captcha` rather than baked into the
 * bundle, so rotating it is an environment change and a restart rather than a
 * rebuild.
 */
export function publicSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY?.trim()
    || process.env.HCAPTCHA_SITE_KEY?.trim()
    || null
}

export function captchaProvider(): Provider | null {
  return captchaEnabled() ? provider() : null
}

/**
 * Check a token with the provider.
 *
 * **Fails closed.** If the provider cannot be reached, verification fails and
 * the signup is refused. This is the opposite of the rate limiter's choice and
 * deliberately so: a limiter that fails open degrades to "no limit", which is
 * where the site already was; a captcha that fails open degrades to "no
 * captcha" precisely when an attacker is in a position to make the provider
 * unreachable. The cost of being wrong is somebody retrying a signup.
 *
 * The caller's address is passed along where the provider accepts it — it lets
 * them correlate a token with where it was solved, which is what catches tokens
 * solved elsewhere and replayed.
 */
export async function verifyCaptcha(token: string, remoteIp?: string): Promise<boolean> {
  const which = provider()
  if (!which || !captchaEnabled()) return true
  if (!token || token.length > 4096) return false

  const form = new URLSearchParams({ secret: secret(which), response: token })
  if (remoteIp) form.set('remoteip', remoteIp)

  try {
    const res = await fetch(ENDPOINTS[which], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      // A captcha check must not be able to hang a signup request forever.
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return false
    const data = await res.json() as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

/** Read a captcha token from a request body, whatever the provider names it. */
export function tokenFromBody(body: Record<string, unknown> | null | undefined): string {
  if (!body) return ''
  for (const key of ['captcha_token', 'cf-turnstile-response', 'h-captcha-response']) {
    const value = body[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/** Verify, or throw the standard refusal. */
export async function assertCaptcha(
  body: Record<string, unknown> | null | undefined,
  remoteIp?: string,
): Promise<void> {
  if (!captchaEnabled()) return
  const ok = await verifyCaptcha(tokenFromBody(body), remoteIp)
  if (!ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Captcha check failed. Reload the page and try again.',
    })
  }
}

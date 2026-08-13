/**
 * Sending email.
 *
 * ## Why HTTP and not SMTP
 *
 * SMTP means a dependency (nodemailer), a persistent connection, and a class of
 * failure — greylisting, TLS negotiation, timeouts — that has to be handled
 * before the first message goes out. Every transactional provider also exposes
 * a JSON endpoint, and `fetch` is in the standard library, so this is a POST
 * with a bearer token and no install. Two providers are supported because the
 * request shape is nearly identical and supporting the second cost four lines.
 *
 * ## What happens when it is not configured
 *
 * It degrades, loudly but harmlessly: `send` returns `false` and logs the link
 * it would have sent. That is deliberate and it is the reason the whole
 * verification flow is written to treat an unverified account as *limited*
 * rather than *locked out* — see `MAIL_ENABLED`. A site that has not set up a
 * mail provider must not become a site nobody can sign into, and during local
 * development the link in the console is exactly what you want anyway.
 */
type Provider = 'resend' | 'postmark' | null

function provider(): Provider {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.POSTMARK_TOKEN) return 'postmark'
  return null
}

/**
 * Whether the site can actually send email.
 *
 * Read by the signup flow to decide whether verification is enforced. Checked
 * at call time rather than cached: an environment variable added and the
 * process restarted is the normal way this becomes true.
 */
export function mailEnabled(): boolean {
  return provider() !== null && !!fromAddress()
}

function fromAddress(): string | null {
  return process.env.MAIL_FROM?.trim() || null
}

/** Absolute origin for links in emails. Without it, no link can be built. */
export function siteOrigin(): string | null {
  const raw = process.env.SITE_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

export type Mail = {
  to: string
  subject: string
  /** Plain text. Every message here is short enough not to need HTML. */
  text: string
}

/**
 * Send one message. Never throws.
 *
 * A failed email must not fail the request that triggered it: somebody whose
 * verification mail bounced still has an account, and the resend button exists
 * precisely for that. Returns whether it went, so callers can say so honestly
 * rather than claiming "check your inbox" into the void.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const which = provider()
  const from = fromAddress()
  if (!which || !from) {
    // The one case where logging the contents is right: there is no inbox for
    // it to arrive in, and a developer running locally needs the link.
    console.info(`[mail] not configured — would send to ${mail.to}: ${mail.subject}\n${mail.text}`)
    return false
  }

  try {
    const res = which === 'resend'
      ? await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
      })
      : await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'x-postmark-server-token': String(process.env.POSTMARK_TOKEN),
          'content-type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify({ From: from, To: mail.to, Subject: mail.subject, TextBody: mail.text }),
      })

    if (!res.ok) {
      // The status, never the body: a provider error can echo the address back,
      // and logs are the wrong place for one.
      console.warn(`[mail] ${which} refused a message: ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.warn('[mail] send failed:', (err as Error)?.message ?? err)
    return false
  }
}

/**
 * Is this plausibly an address?
 *
 * Deliberately loose. The only check that establishes an address is real is
 * sending to it and having somebody click the link, which is the entire point
 * of the verification flow — so anything stricter here just rejects valid
 * unusual addresses (plus-tags, new TLDs, quoted locals) for no gain. This
 * catches typos and refuses anything that could not be an address at all.
 */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim()
  if (v.length < 3 || v.length > 254) return false
  if (/\s/.test(v)) return false
  const at = v.lastIndexOf('@')
  if (at <= 0 || at === v.length - 1) return false
  const domain = v.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

/**
 * Normalise for comparison and storage.
 *
 * Lowercased only. Deliberately *not* stripping dots or plus-tags: those rules
 * are Gmail's, not the internet's, and applying them to other providers merges
 * addresses belonging to different people. The unique index is `COLLATE
 * NOCASE`, which is the same rule expressed once more in the schema.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase()
}

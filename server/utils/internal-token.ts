import { randomBytes } from 'node:crypto'

/**
 * Marks a request as one this server made to itself.
 *
 * The problem it solves: while rendering a page, Nuxt calls its own API with
 * `$fetch`, and server-side `$fetch` does not forward the browser's cookies.
 * To the lockdown middleware those calls look anonymous, so gating the API on
 * the session alone breaks server-rendering for the very admins it's meant to
 * let in.
 *
 * The alternative — recognising internal calls by their shape (no user-agent,
 * empty `remoteAddress`) — is a guess about transport details. Behind a proxy
 * on a Unix socket, real external requests look the same, and the site quietly
 * opens to everyone. A secret is not a guess.
 *
 * Generated per process and never sent to a client: it is attached only to
 * requests whose URL is relative, so it cannot leak to a third-party host, and
 * it dies with the process. There is nothing to rotate and nothing to store.
 */
export const INTERNAL_HEADER = 'x-als-internal'
export const INTERNAL_TOKEN = randomBytes(32).toString('hex')

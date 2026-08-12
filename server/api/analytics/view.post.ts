import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import {
  isPageRequest, looksAutomated, recordPageView, today, touchAccountDay, visitorHash,
} from '~/server/utils/analytics'

/**
 * A page opened by moving around inside the site.
 *
 * Nuxt renders those in the browser without asking the server for a document,
 * so the middleware never sees them. This is the other half: the client plugin
 * posts the path it navigated to, and the counting is the same as for a first
 * load — same normalisation, same visitor hash, same two tables.
 *
 * It takes a path and nothing else. There is no id, no referrer and no account
 * in the body, and the endpoint deliberately can't be used to record anything
 * about a person: the visitor hash is derived here, from the connection, the
 * same way the middleware derives it.
 *
 * It has to be open — it is a beacon, fired by a browser that may be closing —
 * and an open counter with no ceiling is not a statistic. Fifty posts of the
 * same path used to be fifty views; `recordPageView` now throttles a repeat of
 * the same page by the same reader, so they are one. See `shouldCountView`.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: unknown }>(event) ?? {}
  const raw = typeof body.path === 'string' ? body.path : ''
  // A path, not a URL: anything else is either a mistake or someone poking.
  if (!raw.startsWith('/') || raw.length > 512 || !isPageRequest(raw, 'GET')) {
    throw createError({ statusCode: 400, statusMessage: 'path required' })
  }

  const ua = getHeader(event, 'user-agent') ?? ''
  if (looksAutomated(ua)) return { ok: true }

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? ''
  let visitor: string | null = null
  try {
    visitor = visitorHash(getDb(), ip, ua, today())
  } catch { /* counted as a view without a person attached */ }

  recordPageView(raw, visitor)
  try { touchAccountDay(getCurrentAccount(event)?.id) } catch { /* not signed in */ }
  return { ok: true }
})

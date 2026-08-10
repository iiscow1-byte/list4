import { getDb } from '~/server/db'
import {
  isPageRequest, isPrefetch, looksAutomated, recordPageView, today, visitorHash,
} from '~/server/utils/analytics'
import { INTERNAL_HEADER } from '~/server/utils/internal-token'

/**
 * Counts a page being opened.
 *
 * Runs after the lockdown middleware, so a request that never got to see the
 * site isn't counted as having read it.
 *
 * This sees **document requests only** — the first load of a page, and a
 * refresh. Moving between pages in the browser never asks the server for a
 * document, so those views are reported by `plugins/analytics.client.ts`
 * instead. Between them the two cover a visit; neither covers it alone, and
 * counting only this one would report a fraction of the truth.
 */
export default defineEventHandler((event) => {
  const path = event.path ?? '/'
  if (!isPageRequest(path, event.method)) return

  // The server rendering its own pages. It arrives as an ordinary request with
  // the internal token on it, and counting it would double every visit.
  if (getHeader(event, INTERNAL_HEADER)) return

  const ua = getHeader(event, 'user-agent') ?? ''
  if (looksAutomated(ua)) return
  if (isPrefetch(getHeader(event, 'purpose'), getHeader(event, 'sec-purpose'))) return

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? ''
  let visitor: string | null = null
  try {
    visitor = visitorHash(getDb(), ip, ua, today())
  } catch { /* counted as a view without a person attached */ }

  recordPageView(path, visitor)
})

import { requireAccount } from '~/server/utils/auth'
import { fetchUploadDates } from '~/server/utils/youtube-dates'

/**
 * Upload dates for verification videos.
 *
 * `?id=` answers for one video; `?ids=a,b,c` answers for up to 50 in a single
 * call, because the YouTube API charges per request rather than per video.
 * Submitting a whole custom list to the ALL asks about dozens of videos at
 * once, and one request per row would spend the daily quota on a single list.
 *
 * A video that can't be resolved is simply absent from `dates` rather than an
 * error — a missing date is something the submitter can still type.
 *
 * The lookup itself lives in `server/utils/youtube-dates.ts` so that server-side
 * handlers can use it too. `submit-to-all` in particular fills in a missing
 * verification date itself rather than rejecting the row and asking the browser
 * to have done it first.
 *
 * ## Why this needs a session
 *
 * It is a proxy onto a metered third-party quota, and every UI that calls it —
 * the submit form, the review queue, the custom-list hand-off, the level page's
 * admin autofill — is already behind a login. Without this, one script could
 * spend the day's quota from the open web.
 *
 * `configured` tells the client the difference between "no key" and "no date",
 * which the caller could not otherwise distinguish: a missing key silently
 * returned empty results, so the feature looked like it was working and finding
 * nothing.
 */
export default defineEventHandler(async (event) => {
  requireAccount(event)

  const query = getQuery(event)
  const single = String(query.id ?? '').trim()
  const batch = String(query.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const asked = [...new Set([...(single ? [single] : []), ...batch])]
  if (!asked.length) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid video ID.' })
  }
  if (asked.length > 50) {
    throw createError({ statusCode: 400, statusMessage: 'At most 50 videos per request.' })
  }

  const { dates, configured } = await fetchUploadDates(asked)
  return { date: single ? dates[single] ?? null : null, dates, configured }
})

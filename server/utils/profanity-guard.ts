import { firstProfanity } from '~/utils/profanity'

/**
 * Refuse text that shouldn't go on the site.
 *
 * Applied where the text becomes part of the site rather than one person's
 * message — usernames, public list titles and descriptions, comments. The
 * viewer-side filter in `useProfanityFilter` is a reading preference and can be
 * turned off; this can't, which is why it is deliberately the narrower of the
 * two and errs towards letting text through (see `utils/profanity.ts`).
 *
 * Server-side because a client check is a convenience, not a rule: every one of
 * these endpoints is reachable with `curl`.
 */
export function assertClean(text: string | null | undefined, label: string): void {
  const hit = firstProfanity(text)
  if (!hit) return
  throw createError({
    statusCode: 400,
    // Naming the word makes the rejection actionable — "that word isn't
    // allowed" with no indication of which one, in a 2,000-character
    // description, is a puzzle rather than an error message.
    statusMessage: `${label} can't contain "${hit}".`,
  })
}

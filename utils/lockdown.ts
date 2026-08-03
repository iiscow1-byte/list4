/**
 * What the site says while it is closed.
 *
 * One copy, because it appears in four places — the closed page, the login
 * form, the API's 403 and the signup refusal — and four hand-written versions
 * of the same sentence had already drifted into saying different things about
 * who can get in and when it opens.
 */
export const LOCKDOWN_LINES = [
  'The site is closed while it is being developed.',
  'Only administrator accounts can sign in right now.',
  'There is currently no release date.',
] as const

/** The whole notice, as one paragraph. */
export const LOCKDOWN_NOTICE = LOCKDOWN_LINES.join(' ')

/** The headline sentence on its own, for places with room for only one. */
export const LOCKDOWN_HEADLINE = LOCKDOWN_LINES[0]

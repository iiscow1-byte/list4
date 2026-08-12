/**
 * Turning text somebody typed into a spreadsheet into something readable.
 *
 * The About page's copy is a Google Sheet: one paragraph per row, no structure,
 * links pasted in whole with whatever tracking parameters came with them. These
 * two functions are what stands between that and the page.
 */

/**
 * A link printed as where it goes, not as its URL.
 *
 * A pasted URL rendered raw needs `break-all` to stop it shoving the card wider
 * than the page, and what that produces is a wall of hyphenated address nobody
 * reads. The host and first path segment says where you are going; the full
 * thing belongs in the tooltip.
 */
export function linkLabel(href: string): string {
  try {
    const u = new URL(href)
    const host = u.hostname.replace(/^www\./, '')
    const first = u.pathname.split('/').filter(Boolean)[0]
    return first ? `${host}/${first}` : host
  } catch {
    return href
  }
}

/**
 * A FAQ entry, split into its question and its answer.
 *
 * The sheet stores each one as a single paragraph, so the page rendered a stack
 * of identical grey blocks with the questions buried inside them — which is the
 * one shape a FAQ must not have, because a FAQ is read by scanning for a
 * question and stopping.
 *
 * Anything up to the first question mark is the question, but only when it is
 * short enough to be one and something follows it. A 300-character paragraph
 * that happens to contain a rhetorical question in the middle is not a
 * question-and-answer, and pinning a fake heading on it would be worse than
 * leaving it alone.
 */
const MAX_QUESTION = 140

export function faqParts(paragraph: string): { question: string | null; answer: string } {
  const text = paragraph ?? ''
  const mark = text.indexOf('?')
  if (mark > 0 && mark < MAX_QUESTION) {
    const question = text.slice(0, mark + 1).trim()
    const answer = text.slice(mark + 1).trim()
    if (answer) return { question, answer }
  }
  return { question: null, answer: text }
}

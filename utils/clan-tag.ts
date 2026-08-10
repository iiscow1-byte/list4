/**
 * What a clan tag is allowed to be.
 *
 * Two to six characters, letters and digits only. Short because it is rendered
 * in brackets beside a member's name in leaderboard rows, and restricted
 * because of where it is rendered: a tag made of punctuation would read as part
 * of somebody's username rather than as the clan they are in.
 *
 * Shared rather than duplicated — the form checks it as you type and the server
 * checks it before writing, and those two disagreeing is how a form ends up
 * refusing something the server would have taken, or the reverse.
 */
export function isValidClanTag(tag: string | null | undefined): boolean {
  return /^[A-Za-z0-9]{2,6}$/.test((tag ?? '').trim())
}

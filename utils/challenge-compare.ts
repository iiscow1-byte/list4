/**
 * What the comparison drawer's rating filter should be when the Challenge
 * checkbox is ticked or unticked.
 *
 * A challenge and a level of the same tier are not comparable things — one is
 * under thirty seconds and the other is not — so somebody who has just said
 * "this is a challenge" and then opens Compare is looking for other challenges.
 * They were shown the whole 54,000-level list and had to find the rating
 * dropdown, three clicks from the checkbox they had just ticked.
 *
 * The rule owns exactly two states, `''` and `'Challenge'`. Anything else in
 * the dropdown is an answer to a different question — somebody browsing rated
 * levels on purpose — and the checkbox has no business overwriting it. That is
 * the whole reason this is a function rather than an assignment: "follows the
 * checkbox" and "overrules the user" are one character apart.
 *
 * Lives out of `pages/levels/submit.vue` so it can be checked without a
 * browser; the page holds the refs and this holds the rule.
 */
export function challengeCompareFilter(isChallenge: boolean, current: string): string {
  if (isChallenge) return current === '' ? 'Challenge' : current
  return current === 'Challenge' ? '' : current
}

/**
 * Which page of the comparison drawer a given level is on.
 *
 * The trap, and it is one I walked into: in challenge mode the endpoint pages
 * over the **filtered** set — around seven hundred challenges, not fifty-four
 * thousand levels — so a list position is not an index into it. Dividing one by
 * the page size asks for page 80 of a two-page list and gets an empty drawer.
 *
 * A level knows its rank among challenges, and that *is* its index into the
 * filtered set, so a level picked from the list still lands on the right page.
 * When there is no rank to use — the search shortcuts (a tier midpoint, `#N`, a
 * level ID) only ever resolve a list position — challenge mode starts at the
 * top and lets the scroll observer page from there.
 */
export function compareTargetPage(
  opts: { challengeMode: boolean; position: number; challengeRank?: number | null },
  pageSize: number,
): number {
  const index = opts.challengeMode ? opts.challengeRank : opts.position
  if (index == null || !Number.isFinite(index)) return 1
  return Math.max(1, Math.ceil(index / pageSize))
}

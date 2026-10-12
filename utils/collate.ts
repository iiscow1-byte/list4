/**
 * Case- and accent-insensitive name order. One collator, reused: passing
 * options to `localeCompare` builds a new one on every comparison, which made
 * sorting the 58,000-player leaderboard take seconds.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b)
}

/**
 * How much of the All Levels List somebody has beaten, as a percentage.
 *
 * Its own function because the rounding is the whole point. The list is 54,000
 * levels, so almost everybody sits well under one percent: `toFixed(0)` would
 * print "0%" for every player on the site, which tells a reader nothing and
 * tells a player something discouraging *and* wrong. Two decimals below ten
 * percent, one above it, and anything non-zero that would still round to
 * nothing is reported as "<0.01%" rather than as zero.
 *
 * Only a genuine zero returns "0%".
 */
export function listPercent(done: number, total: number): string {
  if (!total || total <= 0) return '—'
  if (done <= 0) return '0%'
  const pct = (done / total) * 100
  if (pct < 0.01) return '<0.01%'
  return `${pct.toFixed(pct < 10 ? 2 : 1)}%`
}

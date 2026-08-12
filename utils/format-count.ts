/**
 * A count short enough to sit in a list row.
 *
 * `1,234` is four characters wider than `1.2k`, and in a row that already
 * carries a rank badge, a name that wants every pixel it can get, and sometimes
 * a tier label, four characters is the difference between a number that fits
 * and a name that truncates. The exact figure belongs in the `title`, where it
 * costs nothing.
 *
 * **It truncates rather than rounds.** 1,999 is `1.9k`, not `2k`. A count that
 * reads higher than the truth is the one kind of wrong worth ruling out — the
 * whole point of the corrections this shipped alongside was that the site was
 * over-counting — and losing a fraction of the last digit is not a cost anybody
 * can notice.
 */
export function compactCount(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(Number(n) || 0))
  if (v < 1_000) return String(v)
  // A tenth below ten thousand, because 1.2k and 9.9k both read cleanly; past
  // that the tenth is noise and the whole thousands are what anybody reads.
  if (v < 10_000) return `${Math.floor(v / 100) / 10}k`
  if (v < 1_000_000) return `${Math.floor(v / 1_000)}k`
  if (v < 10_000_000) return `${Math.floor(v / 100_000) / 10}M`
  return `${Math.floor(v / 1_000_000)}M`
}

/** `1 view` / `2 views` — the exact figure, for a tooltip or a wide row. */
export function viewsLabel(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(Number(n) || 0))
  return `${v.toLocaleString()} view${v === 1 ? '' : 's'}`
}

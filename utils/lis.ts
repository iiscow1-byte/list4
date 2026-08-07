/**
 * Longest increasing subsequence, by index.
 *
 * Two different problems in this codebase reduce to the same question — "which
 * of these levels actually moved?" — and the answer to both is: the ones
 * *outside* the longest run that is still in order. Everything inside that run
 * agrees with everything else inside it, so it is the largest set that can be
 * called "unchanged"; what is left over is the smallest set of levels whose
 * movement explains the difference between the two orderings.
 *
 * Patience sorting with predecessor links — O(n log n), which matters because
 * the callers run it over 54,000 levels and over lists sharing 4,000 with them.
 *
 * Lives in `utils/` rather than beside either caller because one of them is an
 * importer that also runs standalone under `node --experimental-strip-types`,
 * where Nuxt's `~` alias doesn't exist; both import it by relative path.
 */
export function longestIncreasingRun(values: number[]): number[] {
  if (!values.length) return []
  // tails[k] = index of the smallest possible tail of an increasing run of
  // length k+1; prev[i] = the index before i in the run ending at i.
  const tails: number[] = []
  const prev: number[] = new Array(values.length).fill(-1)

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    let lo = 0, hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (values[tails[mid]!]! < v) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1
    tails[lo] = i
  }

  const out: number[] = []
  for (let i = tails[tails.length - 1]!; i !== -1; i = prev[i]!) out.push(i)
  return out.reverse()
}

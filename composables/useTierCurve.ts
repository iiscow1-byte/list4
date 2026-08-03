import type { TierCurve } from '~/utils/tier-ordinal'

/**
 * The ALL's tier→placement curve, fetched once per session.
 *
 * Every page that estimates a placement wants the same forty numbers, and they
 * change on the scale of imports. Shared through `useState` so a custom list
 * with an estimate on every row fetches it once, and so the value is in the
 * server-rendered payload rather than arriving after the first paint.
 */
export function useTierCurve() {
  const state = useState<TierCurve>('tier-curve', () => [])

  const { data } = useFetch<{ curve: TierCurve }>('/api/levels/tier-curve', {
    key: 'tier-curve',
    // An estimate without the curve is the old row-spaced answer, not an
    // error — so a failure here degrades rather than breaking the page.
    default: () => ({ curve: [] }),
  })
  watch(data, (d) => { if (d?.curve?.length) state.value = d.curve }, { immediate: true })

  return state
}

import type { TierCurve } from '~/utils/tier-ordinal'
import type { ComputedRef } from 'vue'

/**
 * The ALL's tier→placement curve, fetched once per session.
 *
 * Every page that estimates a placement wants the same forty numbers, and they
 * change on the scale of imports. Shared through one keyed `useFetch` so a
 * custom list with an estimate on every row fetches it once, and so the value
 * travels in the server-rendered payload rather than arriving after first paint.
 *
 * Derived with a `computed` rather than copied into `useState` by an immediate
 * watcher. That watcher ran during setup, before the fetch resolved, and a
 * watcher does not fire again inside SSR's single render pass — so the server
 * rendered every estimate on the page with an *empty* curve while the importers,
 * reading the same numbers straight from the database, used the real one. Two
 * answers for the same level, from the same formula, decided by which side of
 * the wire it was worked out on.
 *
 * `ready` is that fetch, exposed for the one caller that needs it: a page which
 * *snapshots* estimates into plain data during setup gets one value and keeps
 * it, so it has to await the curve rather than react to it.
 */
export type TierCurveRef = ComputedRef<TierCurve> & { ready: PromiseLike<unknown> }

export function useTierCurve(): TierCurveRef {
  const req = useFetch<{ curve: TierCurve }>('/api/levels/tier-curve', {
    key: 'tier-curve',
    // An estimate without the curve is the old row-spaced answer, not an
    // error — so a failure here degrades rather than breaking the page.
    default: () => ({ curve: [] }),
  })
  const curve = computed<TierCurve>(() => req.data.value?.curve ?? [])
  return Object.assign(curve, { ready: req }) as TierCurveRef
}

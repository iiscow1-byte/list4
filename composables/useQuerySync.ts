import { navigationSettled } from '~/utils/nav-pending'

/**
 * Write values into the current URL's query without getting in the way of a
 * click.
 *
 * A `router.replace` started while another navigation is in flight cancels
 * that navigation. The list sidebars update `?q=` a moment after typing stops,
 * so clicking a result in that moment used to cancel the click and leave you
 * on the old level. This waits for any navigation in flight, applies the
 * values to wherever that landed, and does nothing when the query already
 * says the same thing.
 */
export function useQuerySync() {
  const router = useRouter()
  return async function setQuery(patch: Record<string, string | undefined | null>): Promise<void> {
    await navigationSettled()
    const route = router.currentRoute.value
    const query: Record<string, any> = { ...route.query }
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') delete query[k]
      else query[k] = v
    }
    const same = Object.keys(query).length === Object.keys(route.query).length
      && Object.entries(query).every(([k, v]) => String(route.query[k]) === String(v))
    if (same) return
    await router.replace({ path: route.path, query, hash: route.hash })
  }
}

import { markNavigation } from '~/utils/nav-pending'

/**
 * Tracks whether a route change is in flight, for `useQuerySync`. A query
 * update started during someone's click would cancel the click.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  router.beforeEach(() => { markNavigation(true) })
  router.afterEach(() => { markNavigation(false) })
  router.onError(() => { markNavigation(false) })
})

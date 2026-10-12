import { getDb } from '~/server/db'
import { listVersion } from '~/server/utils/list-ops'

/** Changes whenever the list's order or membership does. Polled by the list panel. */
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  return { stamp: listVersion(getDb()) }
})

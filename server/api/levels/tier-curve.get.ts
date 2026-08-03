import { getDb } from '~/server/db'
import { getTierCurve } from '~/server/utils/tier-curve'

/**
 * Where each tier sits on the list, for the client-side estimator.
 *
 * Public and cacheable: it describes the list as a whole and nothing about the
 * caller. Custom lists estimate placements and tiers in the browser, and
 * without this they were guessing the shape of a curve the server can measure.
 */
export default defineEventHandler((event) => {
  const curve = getTierCurve(getDb())
  setHeader(event, 'cache-control', 'public, max-age=300')
  return { curve }
})

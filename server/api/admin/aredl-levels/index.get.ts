import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * List Aredl-only levels (those not yet on the ALL list). Surfaced in the
 * admin UI so a curator can promote them onto the ALL list one-by-one.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  const items = db.prepare(
    `SELECT uuid, gd_id, position, name, points, legacy, edel_enjoyment, gddl_tier,
            publisher_name, verifier_name, creators_json, promoted_to_position
       FROM aredl_levels
       ORDER BY position ASC`,
  ).all()
  return { items }
})

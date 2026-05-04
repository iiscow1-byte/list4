import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireMod(event)
  const db = getDb()
  const items = db
    .prepare(
      `SELECT p.id, p.gd_id, p.name, p.fps, p.game_version, p.verification, p.verification_url,
              p.verifier, p.verify_date, p.gddl_tier, p.difficulty, p.enjoyment, p.main_skillset,
              p.tags, p.notes, p.submitted_at,
              p.placement_estimate, p.comparison_level_id, p.comparison_level_name, p.pov_placement,
              p.from_open_verification_id, p.from_void_level_id, p.same_as_above,
              p.duplicate_of_id, p.is_alternate, p.alternate_of_id,
              a.username AS submitter
       FROM pending_levels p
       LEFT JOIN accounts a ON a.id = p.submitted_by
       WHERE p.status = 'pending'
       ORDER BY p.submitted_at ASC`,
    )
    .all()
  return { items }
})

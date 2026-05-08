import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireMod(event)
  const q = getQuery(event)
  const source = String(q.source ?? 'submitted').toLowerCase()
  // 'submitted' (default) = user submissions only; 'gdl_import' = GDL API
  // imports only. Splitting the queues keeps each tab focused on the rows
  // that match its workflow.
  const sourceFilter = source === 'gdl_import'
    ? 'AND p.from_gdl_id IS NOT NULL'
    : 'AND p.from_gdl_id IS NULL'
  const db = getDb()
  const items = db
    .prepare(
      `SELECT p.id, p.gd_id, p.name, p.fps, p.game_version, p.verification, p.verification_url,
              p.verifier, p.verify_date, p.gddl_tier, p.difficulty, p.enjoyment, p.main_skillset,
              p.tags, p.notes, p.submitted_at,
              p.placement_estimate, p.comparison_level_id, p.comparison_level_name, p.pov_placement,
              p.from_open_verification_id, p.from_void_level_id, p.same_as_above,
              p.duplicate_of_id, p.is_alternate, p.alternate_of_id, p.rated,
              p.tentative_placement, p.from_gdl_id,
              a.username AS submitter
       FROM pending_levels p
       LEFT JOIN accounts a ON a.id = p.submitted_by
       WHERE p.status = 'pending' ${sourceFilter}
       ORDER BY p.submitted_at ASC`,
    )
    .all()
  return { items }
})

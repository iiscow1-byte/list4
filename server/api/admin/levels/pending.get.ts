import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireMod(event)
  const q = getQuery(event)
  const source = String(q.source ?? 'submitted').toLowerCase()
  // 'submitted' (default) = user submissions only; 'gdl_import' = any external
  // list-importer source (GDL, plus every GDListTemplate-based list mirrored
  // via from_gdtpl_id — TSL etc.). Splitting the queues keeps each tab focused
  // on the rows that match its workflow.
  const sourceFilter = source === 'gdl_import'
    ? 'AND (p.from_gdl_id IS NOT NULL OR p.from_gdtpl_id IS NOT NULL OR p.from_sheet_pending = 1)'
    : 'AND p.from_gdl_id IS NULL AND p.from_gdtpl_id IS NULL AND p.from_sheet_pending = 0'
  const db = getDb()
  // Potential-duplicate detection: an imported level whose name (case-
  // insensitive) matches an existing ALL-list level with a different gd_id.
  // We compute this only for imported rows because user-submitted ones have
  // their own duplicate-flag workflow. Picks the lowest-position match — for
  // the rare double-collision case, the highest-tier level is the most useful
  // pointer to surface in the admin UI.
  const items = db
    .prepare(
      `SELECT p.id, p.gd_id, p.name, p.fps, p.game_version, p.verification, p.verification_url,
              p.verifier, p.verify_date, p.gddl_tier, p.difficulty, p.enjoyment, p.main_skillset,
              p.tags, p.notes, p.submitted_at, p.placement_source,
              p.placement_estimate, p.comparison_level_id, p.comparison_level_name, p.pov_placement,
              p.from_open_verification_id, p.from_void_level_id, p.same_as_above,
              p.duplicate_of_id, p.is_alternate, p.alternate_of_id, p.rated,
              p.tentative_placement, p.from_gdl_id, p.from_gdtpl_id, p.from_sheet_pending,
              g.list_slug AS gdtpl_list_slug,
              g.position AS gdtpl_position,
              a.username AS submitter,
              dup.position AS potential_duplicate_position,
              dup.name     AS potential_duplicate_name
       FROM pending_levels p
       LEFT JOIN accounts a ON a.id = p.submitted_by
       LEFT JOIN gdtpl_levels g ON g.id = p.from_gdtpl_id
       LEFT JOIN levels dup ON dup.id = (
         SELECT l.id FROM levels l
          WHERE l.name = p.name COLLATE NOCASE
            AND (p.gd_id IS NULL OR l.gd_id IS NULL OR l.gd_id <> p.gd_id)
          ORDER BY l.position ASC LIMIT 1
       )
       WHERE p.status = 'pending' ${sourceFilter}
       ORDER BY p.submitted_at ASC`,
    )
    .all()
  return { items }
})

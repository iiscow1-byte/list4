import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { importedPendingSql, submittedPendingSql } from '~/server/utils/pending-source'

export default defineEventHandler((event) => {
  requireMod(event)
  const q = getQuery(event)
  const source = String(q.source ?? 'submitted').toLowerCase()
  // 'submitted' (default) = user submissions only; 'gdl_import' = any external
  // list-importer source (GDL, plus every GDListTemplate-based list mirrored
  // via from_gdtpl_id — TSL etc.). Splitting the queues keeps each tab focused
  // on the rows that match its workflow.
  //
  // The definition of "imported" lives in one place — see the util. Every
  // importer's marker has to appear in it, because "not from any importer" is
  // how the submissions side is defined: miss one and its rows vanish from the
  // imported queue and turn up in the submissions queue, which is exactly what
  // happened to the challenge sheet. The statistics count the two apart now
  // too, and a second copy of the list would be a second chance to get it
  // wrong.
  const sourceFilter = source === 'gdl_import'
    ? `AND ${importedPendingSql('p')}`
    : `AND ${submittedPendingSql('p')}`
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
              p.verifier, p.verify_date, p.gddl_tier, p.gddl_tier_estimated, p.difficulty, p.enjoyment, p.main_skillset,
              p.tags, p.notes, p.submitted_at, p.placement_source,
              p.placement_estimate, p.comparison_level_id, p.comparison_level_name, p.pov_placement,
              p.from_open_verification_id, p.from_void_level_id, p.same_as_above,
              p.duplicate_of_id, p.is_alternate, p.alternate_of_id, p.rated,
              p.tentative_placement, p.from_gdl_id, p.from_gdtpl_id, p.from_sheet_pending,
              p.from_acs_id,
              g.list_slug AS gdtpl_list_slug,
              g.position AS gdtpl_position,
              acs.position AS acs_position,
              -- What the estimate sits between. An imported level arrives with
              -- a number and nothing else, and "#4,312" is not reviewable: the
              -- question a curator is actually asking is "harder than what,
              -- easier than what". These are the two levels that would end up
              -- either side of it, read from the slot the estimate names.
              --
              -- Numbered by position, not by the sheet placement, because that
              -- is the number space the estimate itself is in and the one the
              -- placement box takes. The two differ by however many slots the
              -- sheet skips, so mixing them prints a level "above" the estimate
              -- carrying the estimate's own number.
              -- (No backticks in here: this is a template literal.)
              (SELECT l2.name FROM levels l2 WHERE l2.position < p.placement_estimate
                ORDER BY l2.position DESC LIMIT 1) AS est_above_name,
              (SELECT l2.position FROM levels l2 WHERE l2.position < p.placement_estimate
                ORDER BY l2.position DESC LIMIT 1) AS est_above_position,
              (SELECT l2.name FROM levels l2 WHERE l2.position >= p.placement_estimate
                ORDER BY l2.position ASC LIMIT 1) AS est_below_name,
              (SELECT l2.position FROM levels l2 WHERE l2.position >= p.placement_estimate
                ORDER BY l2.position ASC LIMIT 1) AS est_below_position,
              a.username AS submitter,
              dup.position AS potential_duplicate_position,
              dup.name     AS potential_duplicate_name
       FROM pending_levels p
       LEFT JOIN accounts a ON a.id = p.submitted_by
       LEFT JOIN gdtpl_levels g ON g.id = p.from_gdtpl_id
       LEFT JOIN acs_levels acs ON acs.id = p.from_acs_id
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

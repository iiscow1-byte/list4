import { getDb } from '~/server/db'
import { requireListStaff } from '~/server/utils/auth'

/**
 * The record queue, oldest first.
 *
 * Carries what a reviewer decides on: the run (percent, hz, video), the level
 * it claims (tier for the badge, gd id for the thumbnail, the level's own
 * verification to compare against), and how many more the same submitter has
 * waiting, which is what "Approve all from…" would approve.
 */
export default defineEventHandler((event) => {
  requireListStaff(event)
  const items = getDb().prepare(
    `SELECT r.id,
            r.level_id,
            r.player_name,
            r.percent,
            r.hz,
            r.video,
            r.submitter_note,
            r.submitted_at,
            r.is_verification_claim,
            l.position,
            l.name AS level_name,
            l.gd_id AS level_gd_id,
            l.gddl_tier AS level_tier,
            l.points AS level_points,
            l.verifier AS level_verifier,
            l.verification_url AS level_verification_url,
            sub.username AS submitter,
            (SELECT COUNT(*) FROM records r2
              WHERE r2.permanent = 0 AND r2.submitted_by = r.submitted_by) AS submitter_pending
       FROM records r
       JOIN levels l        ON l.id = r.level_id
       LEFT JOIN accounts sub ON sub.id = r.submitted_by
      WHERE r.permanent = 0
      ORDER BY r.submitted_at ASC`,
  ).all()
  return { items }
})

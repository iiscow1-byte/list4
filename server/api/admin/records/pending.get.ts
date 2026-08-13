import { getDb } from '~/server/db'
import { requireListStaff } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireListStaff(event)
  const items = getDb().prepare(
    `SELECT r.id,
            r.level_id,
            r.player_name,
            r.video,
            r.submitter_note,
            r.submitted_at,
            r.is_verification_claim,
            l.position,
            l.name AS level_name,
            l.verifier AS level_verifier,
            sub.username AS submitter
       FROM records r
       JOIN levels l        ON l.id = r.level_id
       LEFT JOIN accounts sub ON sub.id = r.submitted_by
      WHERE r.permanent = 0
      ORDER BY r.submitted_at ASC`,
  ).all()
  return { items }
})

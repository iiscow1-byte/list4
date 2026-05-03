import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireMod(event)
  const db = getDb()
  const items = db
    .prepare(
      `SELECT o.id, o.gd_id, o.name, o.fps, o.game_version, o.showcase_url, o.verifier,
              o.gddl_tier, o.difficulty, o.enjoyment, o.main_skillset, o.tags, o.notes,
              o.placement_source, o.submitted_at, o.status,
              a.username AS submitter
         FROM open_verifications o
         LEFT JOIN accounts a ON a.id = o.submitted_by
        WHERE o.status = 'pending'
        ORDER BY o.submitted_at ASC, o.id ASC`,
    )
    .all()
  return { items }
})

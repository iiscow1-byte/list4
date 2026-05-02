import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireMod(event)
  const db = getDb()
  // Two passes since opinions can target either the main `levels` table or
  // `void_levels`. The two SELECTs share the same shape, so we union them and
  // sort across the merged set.
  const main = db.prepare(
    `SELECT o.id, o.list_kind, o.level_id, o.proof_url, o.gddl_tier, o.difficulty,
            o.enjoyment, o.notes, o.request_relocation, o.requested_position,
            o.comparison_level_id, o.comparison_level_name, o.source_record_id,
            o.submitted_at, o.submitted_by,
            l.name AS level_name, l.position AS level_position,
            l.gddl_tier AS level_tier, l.difficulty AS level_difficulty,
            sub.username AS submitter
       FROM opinions o
       JOIN levels l        ON l.id = o.level_id
       LEFT JOIN accounts sub ON sub.id = o.submitted_by
      WHERE o.status = 'pending' AND o.list_kind = 'main'`,
  ).all() as any[]

  const voidRows = db.prepare(
    `SELECT o.id, o.list_kind, o.level_id, o.proof_url, o.gddl_tier, o.difficulty,
            o.enjoyment, o.notes, o.request_relocation, o.requested_position,
            o.comparison_level_id, o.comparison_level_name, o.source_record_id,
            o.submitted_at, o.submitted_by,
            v.name AS level_name, v.position AS level_position,
            NULL AS level_tier, NULL AS level_difficulty,
            sub.username AS submitter
       FROM opinions o
       JOIN void_levels v   ON v.id = o.level_id
       LEFT JOIN accounts sub ON sub.id = o.submitted_by
      WHERE o.status = 'pending' AND o.list_kind = 'void'`,
  ).all() as any[]

  const items = [...main, ...voidRows].sort(
    (a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)),
  )
  return { items }
})

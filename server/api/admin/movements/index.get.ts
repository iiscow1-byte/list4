import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  requireMod(event)
  const db = getDb()
  const items = db.prepare(
    `SELECT m.id, m.level_name, m.level_gd_id, m.from_position, m.to_position,
            m.notes, m.submitted_at, m.status,
            a.username AS submitter
       FROM pending_movements m
       LEFT JOIN accounts a ON a.id = m.submitted_by
      WHERE m.status = 'pending'
      ORDER BY m.submitted_at ASC`,
  ).all() as {
    id: number
    level_name: string
    level_gd_id: number | null
    from_position: number
    to_position: number
    notes: string | null
    submitted_at: string
    status: string
    submitter: string | null
  }[]
  return { items }
})

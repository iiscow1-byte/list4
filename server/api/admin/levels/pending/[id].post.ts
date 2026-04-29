import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

/**
 * Approve or reject a pending level submission.
 * On approve, the level is inserted into `levels` at `placement` (other rows
 * at-and-below shift down by 1). The new row is marked permanent so future
 * sheet imports won't overwrite it.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const body = await readBody<{ action: 'approve' | 'reject'; placement?: number }>(event)
  if (body.action !== 'approve' && body.action !== 'reject') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }

  const db = getDb()
  const sub = db.prepare(`SELECT * FROM pending_levels WHERE id = ? AND status = 'pending'`).get(id) as any
  if (!sub) throw createError({ statusCode: 404, statusMessage: 'Submission not found or already decided.' })

  if (body.action === 'reject') {
    db.prepare(`UPDATE pending_levels SET status='rejected', decided_by=?, decided_at=datetime('now') WHERE id = ?`)
      .run(account.id, id)
    return { ok: true }
  }

  // --- approve ---
  const placement = Number(body.placement)
  if (!Number.isInteger(placement) || placement <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A valid placement (1-based position) is required.' })
  }

  // Decide which list to insert into: void list (no difficulty opinion) vs main.
  const goesToVoid = !sub.gddl_tier && !sub.difficulty
  const isPermanent = !goesToVoid // void rows live in their own table; the permanent flag is for the main list

  db.exec('BEGIN')
  try {
    if (goesToVoid) {
      // Shift void positions and insert.
      const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM void_levels`).get() as { m: number | null }).m ?? 0
      const insertPos = Math.min(placement, maxPos + 1)
      db.prepare(`UPDATE void_levels SET position = position + 1 WHERE position >= ?`).run(insertPos)
      db.prepare(
        `INSERT INTO void_levels (position, name, gd_id, verify_date, demon_ranking, placement_source,
                                  verification, verification_url, added_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(
        insertPos,
        sub.name ?? `Level ${sub.gd_id}`,
        sub.gd_id,
        sub.verify_date,
        sub.difficulty,
        'ALL Submission',
        sub.verification,
        sub.verification_url,
      )
    } else {
      // Shift main list positions and insert.
      const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
      const insertPos = Math.min(placement, maxPos + 1)
      db.prepare(`UPDATE levels SET position = position + 1 WHERE position >= ?`).run(insertPos)
      db.prepare(
        `INSERT INTO levels
          (position, name, gd_id, gddl_tier, difficulty, main_skillset, verify_date,
           verification, verification_url, year_verified, category, source_tab,
           creator, permanent, enjoyment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', 'ALL Submission', NULL, 1, ?)`,
      ).run(
        insertPos,
        sub.name ?? `Level ${sub.gd_id}`,
        sub.gd_id,
        sub.gddl_tier,
        sub.difficulty,
        sub.main_skillset,
        sub.verify_date,
        sub.verification,
        sub.verification_url,
        sub.verify_date && /^\d{4}/.test(sub.verify_date) ? Number(sub.verify_date.slice(0, 4)) : null,
        sub.enjoyment,
      )
    }

    db.prepare(`UPDATE pending_levels SET status='approved', decided_by=?, decided_at=datetime('now'), placement=? WHERE id = ?`)
      .run(account.id, placement, id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { ok: true, voided: goesToVoid, permanent: isPermanent }
})

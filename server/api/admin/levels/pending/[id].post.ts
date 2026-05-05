import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { recomputePoints } from '~/server/utils/points'
import { recordPlacement } from '~/server/utils/changes'
import { postLevelStatusUpdate } from '~/server/utils/leaderboard-discord'

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
  const body = await readBody<{
    action: 'approve' | 'reject' | 'await' | 'save_placement'
    placement?: number
    reason?: string
    same_as_above?: boolean
    duplicate_of_id?: number | null
    is_alternate?: boolean
    alternate_of_id?: number | null
    gddl_tier?: string
    difficulty?: string
    placement_suggestion?: number
  }>(event)
  if (body.action !== 'approve' && body.action !== 'reject' && body.action !== 'await' && body.action !== 'save_placement') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }

  const db = getDb()

  if (body.action === 'save_placement') {
    const n = (typeof body.placement === 'number' && Number.isInteger(body.placement) && body.placement > 0) ? body.placement : null
    db.prepare(`UPDATE pending_levels SET placement_estimate = ? WHERE id = ?`).run(n, id)
    return { ok: true }
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const sub = db.prepare(`SELECT * FROM pending_levels WHERE id = ? AND status = 'pending'`).get(id) as any
  if (!sub) throw createError({ statusCode: 404, statusMessage: 'Submission not found or already decided.' })

  // Admin can override the submitter's flags from the review UI before approving.
  const sameAsAbove = typeof body.same_as_above === 'boolean'
    ? (body.same_as_above ? 1 : 0)
    : (sub.same_as_above ? 1 : 0)
  const isAlternate = typeof body.is_alternate === 'boolean'
    ? (body.is_alternate ? 1 : 0)
    : (sub.is_alternate ? 1 : 0)
  const duplicateOfId = body.duplicate_of_id !== undefined ? (body.duplicate_of_id ?? null) : (sub.duplicate_of_id ?? null)
  const alternateOfId = body.alternate_of_id !== undefined ? (body.alternate_of_id ?? null) : (sub.alternate_of_id ?? null)
  sub.same_as_above = sameAsAbove
  sub.is_alternate = isAlternate
  sub.duplicate_of_id = duplicateOfId
  sub.alternate_of_id = alternateOfId

  if (body.action === 'reject') {
    db.prepare(`UPDATE pending_levels SET status='rejected', decided_by=?, decided_at=datetime('now') WHERE id = ?`)
      .run(account.id, id)
    if (sub.submitted_by) {
      sendInboxMessage(db, sub.submitted_by, {
        kind: 'level_rejected',
        subject: `Your submission for "${sub.name ?? `Level ${sub.gd_id}`}" was rejected`,
        body: reason || null,
        related_kind: 'pending_level',
        related_id: sub.id,
        sent_by: account.id,
      })
    }
    return { ok: true }
  }

  // --- send to awaiting placement (publicly visible holding list) ---
  if (body.action === 'await') {
    const submitter = sub.submitted_by
      ? (db.prepare(`SELECT username FROM accounts WHERE id = ?`).get(sub.submitted_by) as { username: string } | undefined)?.username ?? null
      : null
    let awaitingId: number | null = null
    db.exec('BEGIN')
    try {
      const placementSuggestion = (typeof body.placement_suggestion === 'number' && Number.isInteger(body.placement_suggestion) && body.placement_suggestion > 0)
        ? body.placement_suggestion
        : (sub.placement_estimate != null ? sub.placement_estimate : null)
      const awaitingResult = db.prepare(
        `INSERT INTO awaiting_levels
          (gd_id, name, fps, game_version, verification, verification_url, verifier, verify_date,
           gddl_tier, difficulty, enjoyment, main_skillset, tags, notes, submitter, pending_id, approved_by,
           placement_source, same_as_above, duplicate_of_id, is_alternate, alternate_of_id, placement_suggestion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        sub.gd_id,
        sub.name ?? `Level ${sub.gd_id}`,
        sub.fps,
        sub.game_version,
        sub.verification,
        sub.verification_url,
        sub.verifier,
        sub.verify_date,
        sub.gddl_tier,
        sub.difficulty,
        sub.enjoyment,
        sub.main_skillset,
        sub.tags,
        sub.notes,
        submitter,
        sub.id,
        account.id,
        sub.placement_source ?? 'All Levels List',
        sub.same_as_above ? 1 : 0,
        sub.duplicate_of_id ?? null,
        sub.is_alternate ? 1 : 0,
        sub.alternate_of_id ?? null,
        placementSuggestion,
      )
      awaitingId = Number(awaitingResult.lastInsertRowid)
      db.prepare(
        `UPDATE pending_levels SET status='approved', decided_by=?, decided_at=datetime('now') WHERE id = ?`,
      ).run(account.id, id)
      if (sub.from_open_verification_id) {
        db.prepare(`DELETE FROM open_verifications WHERE id = ?`).run(sub.from_open_verification_id)
      }
      if (sub.from_void_level_id) {
        db.prepare(`DELETE FROM void_levels WHERE id = ?`).run(sub.from_void_level_id)
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    // Fire-and-forget level-status Discord notification.
    postLevelStatusUpdate(db, {
      destination: 'awaiting',
      levelName: sub.name ?? `Level ${sub.gd_id}`,
      gddlTier: sub.gddl_tier ?? null,
      difficulty: sub.difficulty ?? null,
      submitter: submitter ?? null,
      verificationUrl: sub.verification_url ?? null,
      awaitingId,
    }).catch(() => {})

    return { ok: true, awaiting: true }
  }

  // --- approve ---
  const placement = Number(body.placement)
  if (!Number.isInteger(placement) || placement <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'A valid placement (1-based position) is required.' })
  }

  // Decide which list to insert into: void list (no difficulty opinion) vs main.
  const goesToVoid = !sub.gddl_tier && !sub.difficulty
  const isPermanent = !goesToVoid // void rows live in their own table; the permanent flag is for the main list
  let voidInsertPos: number | null = null

  db.exec('BEGIN')
  try {
    if (goesToVoid) {
      // Shift later positions down by one to make room. Done in two steps via
      // negative placeholders to avoid the UNIQUE-constraint collisions SQLite
      // would otherwise hit while the UPDATE walks the rows.
      const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM void_levels`).get() as { m: number | null }).m ?? 0
      const insertPos = Math.min(placement, maxPos + 1)
      voidInsertPos = insertPos
      db.prepare(`UPDATE void_levels SET position = -(position + 1) WHERE position >= ?`).run(insertPos)
      db.prepare(`UPDATE void_levels SET position = -position WHERE position < 0`).run()
      db.prepare(
        `INSERT INTO void_levels (position, name, gd_id, verify_date, demon_ranking, placement_source,
                                  verification, verification_url, added_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        insertPos,
        sub.name ?? `Level ${sub.gd_id}`,
        sub.gd_id,
        sub.verify_date,
        sub.difficulty,
        sub.placement_source ?? 'All Levels List',
        sub.verification,
        sub.verification_url,
        sub.submitted_at ?? null,
      )
    } else {
      // Shift main list positions down by one. Same negate-then-flip pattern.
      const maxPos = (db.prepare(`SELECT MAX(position) AS m FROM levels`).get() as { m: number | null }).m ?? 0
      const insertPos = Math.min(placement, maxPos + 1)
      db.prepare(`UPDATE levels SET position = -(position + 1) WHERE position >= ?`).run(insertPos)
      db.prepare(`UPDATE levels SET position = -position WHERE position < 0`).run()
      // pov_placement is a snapshot of where the level was *first* placed —
      // recorded once on acceptance, never updated by later position moves.
      const result = db.prepare(
        `INSERT INTO levels
          (position, name, gd_id, gddl_tier, difficulty, main_skillset, verify_date,
           verification, verification_url, year_verified, category, source_tab,
           creator, permanent, enjoyment, pov_placement, placement_source, submitted_by,
           same_as_above, duplicate_of_id, is_alternate, alternate_of_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', 'ALL Submission', NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        insertPos,
        sub.name ?? `Level ${sub.gd_id}`,
        sub.gd_id,
        (typeof body.gddl_tier === 'string' && body.gddl_tier.trim()) ? body.gddl_tier.trim() : sub.gddl_tier,
        (typeof body.difficulty === 'string' && body.difficulty.trim()) ? body.difficulty.trim() : sub.difficulty,
        sub.main_skillset,
        sub.verify_date,
        sub.verification,
        sub.verification_url,
        sub.verify_date && /^\d{4}/.test(sub.verify_date) ? Number(sub.verify_date.slice(0, 4)) : null,
        sub.enjoyment,
        insertPos,
        sub.placement_source ?? 'All Levels List',
        sub.submitted_by,
        sub.same_as_above ? 1 : 0,
        sub.duplicate_of_id ?? null,
        sub.is_alternate ? 1 : 0,
        sub.alternate_of_id ?? null,
      )
      // Record the addition so it shows up on the recent-changes feed.
      recordPlacement(db, Number(result.lastInsertRowid), insertPos, account.id)
    }

    db.prepare(`UPDATE pending_levels SET status='approved', decided_by=?, decided_at=datetime('now'), placement=? WHERE id = ?`)
      .run(account.id, placement, id)
    // Promoting a verification submission removes the level from the open-
    // verifications list — it now lives on the main (or void) list with a
    // verifier credited.
    if (sub.from_open_verification_id) {
      db.prepare(`DELETE FROM open_verifications WHERE id = ?`).run(sub.from_open_verification_id)
    }
    if (sub.from_void_level_id) {
      db.prepare(`DELETE FROM void_levels WHERE id = ?`).run(sub.from_void_level_id)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  // Inserting at `insertPos` shifts every level below it; tier midpoints
  // change too, so refresh the auto-computed points for the whole list.
  if (!goesToVoid) recomputePoints(db)

  // Fire-and-forget level-status Discord notification for void approvals.
  if (goesToVoid) {
    const submitterName = sub.submitted_by
      ? (db.prepare(`SELECT username FROM accounts WHERE id = ?`).get(sub.submitted_by) as { username: string } | undefined)?.username ?? null
      : null
    postLevelStatusUpdate(db, {
      destination: 'void',
      levelName: sub.name ?? `Level ${sub.gd_id}`,
      gddlTier: sub.gddl_tier ?? null,
      difficulty: sub.difficulty ?? null,
      submitter: submitterName,
      verificationUrl: sub.verification_url ?? null,
      voidPosition: voidInsertPos,
    }).catch(() => {})
  }

  return { ok: true, voided: goesToVoid, permanent: isPermanent }
})

import type { DatabaseSync } from 'node:sqlite'
import { insertLevelAt, type NewLevel } from './list-ops'

type Flags = {
  gddl_tier?: unknown
  difficulty?: unknown
  same_as_above?: unknown
  duplicate_of_id?: unknown
  is_alternate?: unknown
  alternate_of_id?: unknown
  tentative_placement?: unknown
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const bool = (v: unknown, fallback: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : fallback ? 1 : 0)
const idOr = (v: unknown, fallback: unknown) => (v !== undefined ? (Number(v) || null) : (Number(fallback) || null))

/**
 * Put a pending or awaiting submission on the main list at `placement`.
 * `flags` are the reviewer's overrides from the review form.
 */
export function placeSubmission(
  db: DatabaseSync,
  sub: Record<string, any>,
  placement: number,
  opts: { actorId: number; submittedBy: number | null; flags?: Flags },
): { id: number; position: number } {
  const f = opts.flags ?? {}
  const verifyYear = typeof sub.verify_date === 'string' && /^\d{4}/.test(sub.verify_date)
    ? Number(sub.verify_date.slice(0, 4))
    : null
  const fields: NewLevel = {
    name: sub.name ?? `Level ${sub.gd_id}`,
    gd_id: sub.gd_id ?? null,
    gddl_tier: str(f.gddl_tier) ?? sub.gddl_tier ?? null,
    difficulty: str(f.difficulty) ?? sub.difficulty ?? null,
    main_skillset: sub.main_skillset ?? null,
    verify_date: sub.verify_date ?? null,
    verification: sub.verification ?? null,
    verification_url: sub.verification_url ?? null,
    year_verified: verifyYear,
    source_tab: 'ALL Submission',
    enjoyment: sub.enjoyment ?? null,
    placement_source: sub.placement_source ?? 'All Levels List',
    submitted_by: opts.submittedBy,
    same_as_above: bool(f.same_as_above, sub.same_as_above),
    duplicate_of_id: idOr(f.duplicate_of_id, sub.duplicate_of_id),
    is_alternate: bool(f.is_alternate, sub.is_alternate),
    alternate_of_id: idOr(f.alternate_of_id, sub.alternate_of_id),
    rated: sub.rated ?? null,
    tentative_placement: bool(f.tentative_placement, sub.tentative_placement),
  }
  const placed = insertLevelAt(db, placement, fields, opts.actorId)
  // Where it was first placed; never updated by later moves.
  db.prepare(`UPDATE levels SET pov_placement = ? WHERE id = ?`).run(placed.position, placed.id)
  return placed
}

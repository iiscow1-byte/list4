import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { afterListChange, moveLevel, moveLevelBelow } from '~/server/utils/list-ops'
import { logActivity } from '~/server/utils/activity-log'

/**
 * Move the level at `position`.
 *
 * Body: `{ to }` for a target rank, or `{ below_id }` to put it directly under
 * another level (`below_id: null` for the top). `keep_tier` stops the level
 * taking the tier of its new neighbours. `to_placement` is accepted as an
 * older name for `to`.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const fromPos = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(fromPos) || fromPos <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad source position.' })
  }
  const body = await readBody<{ to?: number; to_placement?: number; below_id?: number | null; keep_tier?: boolean }>(event) ?? {}
  const db = getDb()

  const level = db.prepare(`SELECT id, name FROM levels WHERE position = ?`).get(fromPos) as { id: number; name: string } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: `No level at #${fromPos}.` })

  const opts = { keepTier: body.keep_tier === true }
  let result
  try {
    if ('below_id' in body) {
      const below = body.below_id == null ? null : Number(body.below_id)
      if (below !== null && !Number.isInteger(below)) throw new Error('Bad target level.')
      result = moveLevelBelow(db, level.id, below, account.id, opts)
    } else {
      const to = Number(body.to ?? body.to_placement)
      if (!Number.isInteger(to) || to <= 0) throw new Error('A target placement is required.')
      result = moveLevel(db, fromPos, to, account.id, opts)
    }
  } catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e?.message ?? 'Move failed.' })
  }

  if (result.moved) {
    afterListChange(db)
    logActivity({
      kind: 'level.move',
      area: 'levels',
      severity: 'notable',
      actor: account,
      subject: { kind: 'level', id: level.id, label: level.name },
      summary: `Moved ${level.name} from #${result.from} to #${result.to}`,
      detail: { from: result.from, to: result.to, tier_from: result.tier_from ?? null, tier_to: result.tier_to ?? null },
    }, db)
  }

  return {
    ok: true,
    from: result.from,
    to: result.to,
    moved: result.moved,
    tier_from: result.tier_from ?? null,
    tier_to: result.tier_to ?? null,
  }
})

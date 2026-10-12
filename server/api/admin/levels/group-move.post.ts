import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { afterListChange, moveLevelsBelow } from '~/server/utils/list-ops'
import { logActivity } from '~/server/utils/activity-log'

/**
 * Move several levels as a block, keeping their order, directly under one level.
 *
 * Body: `{ positions: number[], below_position: number | null, keep_tier? }`.
 * `below_position: null` puts the block at the top of the list.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const body = await readBody<{ positions?: unknown; below_position?: unknown; keep_tier?: unknown }>(event) ?? {}

  const positions: number[] = Array.isArray(body.positions)
    ? [...new Set(body.positions.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : []
  if (!positions.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one level.' })
  if (body.below_position === undefined) throw createError({ statusCode: 400, statusMessage: 'Pick where the levels go.' })

  const db = getDb()
  const idAt = db.prepare(`SELECT id FROM levels WHERE position = ?`)
  const ids = positions
    .map((p) => (idAt.get(p) as { id: number } | undefined)?.id)
    .filter((id): id is number => id != null)

  let belowId: number | null = null
  if (body.below_position !== null) {
    const p = Number(body.below_position)
    belowId = (idAt.get(p) as { id: number } | undefined)?.id ?? null
    if (belowId == null) throw createError({ statusCode: 400, statusMessage: `No level at #${p}.` })
    if (ids.includes(belowId)) throw createError({ statusCode: 400, statusMessage: 'The target is one of the levels being moved.' })
  }

  const res = moveLevelsBelow(db, ids, belowId, account.id, { keepTier: body.keep_tier === true })
  if (res.moved) {
    afterListChange(db)
    logActivity({
      kind: 'level.group-move',
      area: 'levels',
      severity: 'notable',
      actor: account,
      subject: null,
      summary: `Moved ${res.moved} level${res.moved === 1 ? '' : 's'} as a group`,
      detail: { positions, below_position: body.below_position },
    }, db)
  }
  return { ok: true, ...res }
})

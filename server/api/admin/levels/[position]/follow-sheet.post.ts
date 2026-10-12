import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'
import { afterListChange, clearSiteFields, parseSiteFields, unpinLevel } from '~/server/utils/list-ops'
import { logActivity } from '~/server/utils/activity-log'

/**
 * Undo site edits on a level so the sheet decides again.
 *
 * Body: `{ placement: true }` drops the pin and puts the level back where the
 * sheet has it; `{ fields: ['gddl_tier', …] }` or `{ fields: 'all' }` lets the
 * sheet overwrite those fields on the next refresh.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const position = Number(getRouterParam(event, 'position'))
  const body = await readBody<{ placement?: boolean; fields?: string[] | 'all' }>(event) ?? {}
  const db = getDb()
  const level = db.prepare(`SELECT id, name, pinned, site_fields FROM levels WHERE position = ?`).get(position) as
    { id: number; name: string; pinned: number; site_fields: string | null } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  let to = position
  if (body.placement && level.pinned) {
    const res = unpinLevel(db, level.id, account.id)
    if (res?.moved) to = res.to
  }
  if (body.fields === 'all') clearSiteFields(db, level.id)
  else if (Array.isArray(body.fields) && body.fields.length) clearSiteFields(db, level.id, body.fields.map(String))
  afterListChange(db, { points: to !== position })

  logActivity({
    kind: 'level.follow-sheet',
    area: 'levels',
    severity: 'info',
    actor: account,
    subject: { kind: 'level', id: level.id, label: level.name },
    summary: `Handed ${level.name} back to the sheet${body.placement ? ' (placement)' : ''}${body.fields ? ' (fields)' : ''}`,
    detail: { placement: !!body.placement, fields: body.fields ?? null, from: position, to },
  }, db)

  const after = db.prepare(`SELECT pinned, site_fields FROM levels WHERE id = ?`).get(level.id) as { pinned: number; site_fields: string | null }
  return { ok: true, position: to, pinned: !!after.pinned, site_fields: [...parseSiteFields(after.site_fields)] }
})

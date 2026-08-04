import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Put a level on the challenge list, or take it off.
 *
 * Its own endpoint rather than a field on the metadata PATCH, because the two
 * have different rules. That PATCH refuses any level that isn't `permanent`,
 * and rightly so: everything it writes is sheet-owned and the next import would
 * overwrite it. These two columns are the opposite kind of value — a site-side
 * editorial decision no importer touches — and routing them through the same
 * door would have forced an admin to freeze a level against all future imports
 * just to correct which list it appears on.
 *
 * Marking deliberately does *not* go through `rated = 'Challenge'`, which looks
 * like the obvious way to do it. That column is imported from the sheet, and
 * `applyRatedFromSheet` clears any 'Challenge' the sheet doesn't also say — so
 * an admin's decision would have held until the next import and then quietly
 * undone itself.
 *
 * Both columns are written on every call, so the contradictory state where a
 * level is forced on and off at once is unreachable from here.
 *
 * Admin-only. Whether a level is a challenge decides a whole public ranking,
 * not one row's metadata.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad position.' })
  }

  const body = await readBody<{ challenge?: unknown }>(event) ?? {}
  if (typeof body.challenge !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: '`challenge` must be true or false.' })
  }

  const db = getDb()
  const level = db.prepare(`SELECT id, name FROM levels WHERE position = ?`)
    .get(position) as { id: number; name: string } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  db.prepare(`UPDATE levels SET force_challenge = ?, not_challenge = ? WHERE id = ?`)
    .run(body.challenge ? 1 : 0, body.challenge ? 0 : 1, level.id)

  return { ok: true, name: level.name, challenge: body.challenge }
})

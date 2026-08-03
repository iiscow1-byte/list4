import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/**
 * Take a level off the challenge list, or put it back.
 *
 * Its own endpoint rather than a field on the metadata PATCH, because the two
 * have different rules. That PATCH refuses any level that isn't `permanent`,
 * and rightly so: everything it writes is sheet-owned and the next import would
 * overwrite it. `not_challenge` is the opposite kind of value — a site-side
 * editorial decision no importer touches — and routing it through the same door
 * would have forced an admin to freeze a level against all future imports just
 * to correct which list it appears on.
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

  db.prepare(`UPDATE levels SET not_challenge = ? WHERE id = ?`)
    .run(body.challenge ? 0 : 1, level.id)

  return { ok: true, name: level.name, challenge: body.challenge }
})

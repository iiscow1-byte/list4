import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id.' })
  }
  const result = getDb().prepare(
    `DELETE FROM progress_posts WHERE id = ? AND account_id = ?`,
  ).run(id, me.id)
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  }
  return { ok: true }
})

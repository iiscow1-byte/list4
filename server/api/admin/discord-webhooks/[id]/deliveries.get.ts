import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/** The newest sends to one webhook, newest first. */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }
  const items = getDb().prepare(
    `SELECT id, at, what, ok, status, messages
       FROM discord_deliveries
      WHERE webhook_id = ?
      ORDER BY id DESC
      LIMIT 25`,
  ).all(id)
  return { items }
})

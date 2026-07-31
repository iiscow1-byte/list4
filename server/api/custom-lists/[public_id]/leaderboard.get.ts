import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { buildLeaderboard } from '~/server/utils/custom-list-scoring'

/** Players ranked by the points their approved records on this list are worth. */
export default defineEventHandler((event) => {
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, is_public FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; is_public: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })

  const me = getCurrentAccount(event)
  if (!list.is_public && (!me || me.id !== list.owner_account_id)) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }

  return { leaderboard: buildLeaderboard(db, list.id) }
})

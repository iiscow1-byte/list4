import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { mutualFriends } from '~/server/utils/friends'

/**
 * The friends you and another account have in common — the list, not the count.
 *
 * The profile page has shown a "N mutuals" chip for a while with nothing behind
 * it: a number you could read and not act on. This is what makes it a thing you
 * can click. Signed-in only, because "in common with *you*" has no meaning
 * otherwise.
 */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const username = String(getQuery(event).username ?? '').trim()
  if (!username) throw createError({ statusCode: 400, statusMessage: 'username required.' })

  const db = getDb()
  const them = db.prepare(
    `SELECT id FROM accounts WHERE username = ? COLLATE NOCASE AND banned_at IS NULL`,
  ).get(username) as { id: number } | undefined
  if (!them) throw createError({ statusCode: 404, statusMessage: 'No such account.' })
  if (them.id === me.id) return { items: [] }

  return { items: mutualFriends(db, me.id, them.id) }
})

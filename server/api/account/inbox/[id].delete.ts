import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * Delete one message.
 *
 * The inbox had no way to remove anything: a rejected submission from months
 * ago sat there forever, and "mark all read" only changed its colour. An inbox
 * you cannot clear is a list you stop reading.
 *
 * Only the recipient's own. Deleting a message does *not* answer or withdraw
 * whatever it was about — declining a clan invite is a separate act with its
 * own endpoint, and conflating the two would mean tidying up your inbox
 * silently turned down every invitation in it.
 */
export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }

  const db = getDb()
  const row = db.prepare(
    `SELECT account_id FROM inbox_messages WHERE id = ?`,
  ).get(id) as { account_id: number } | undefined
  if (!row || row.account_id !== me.id) {
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
  }

  db.prepare(`DELETE FROM inbox_messages WHERE id = ?`).run(id)
  return { ok: true }
})

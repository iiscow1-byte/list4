import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody<{ target?: string }>(event)
  const target = (body?.target ?? '').toString().trim()
  if (!target) throw createError({ statusCode: 400, statusMessage: 'target required' })

  getDb().prepare(
    `DELETE FROM follows WHERE follower_account_id = ? AND target_name = ? COLLATE NOCASE`,
  ).run(me.id, target)

  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { resolveTargetName } from '~/server/utils/follows'

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody<{ target?: string }>(event)
  const raw = (body?.target ?? '').toString()
  if (!raw.trim()) throw createError({ statusCode: 400, statusMessage: 'target required' })

  const db = getDb()
  const target = resolveTargetName(db, raw)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'No such profile.' })

  // Prevent following yourself — uses the same canonical-name resolution as
  // every other lookup so it works for both claimed and unclaimed identities.
  const myCanonical = me.claimed_player ?? me.username
  if (target.toLowerCase() === myCanonical.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: "You can't follow yourself." })
  }

  db.prepare(
    `INSERT OR IGNORE INTO follows (follower_account_id, target_name) VALUES (?, ?)`,
  ).run(me.id, target)

  return { ok: true, target }
})

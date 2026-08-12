import { getDb } from '~/server/db'
import { verifyPassword, createSession, setSessionCookie } from '~/server/utils/auth'
import { touchAccountDay } from '~/server/utils/analytics'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')

  const db = getDb()
  const row = db.prepare(
    `SELECT id, username, password_hash, password_salt, role, banned_at, banned_reason
       FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as any
  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid username or password.' })
  }
  if (row.banned_at) {
    throw createError({
      statusCode: 403,
      statusMessage: row.banned_reason
        ? `Account banned: ${row.banned_reason}`
        : 'Account banned.',
    })
  }
  const token = createSession(row.id)
  setSessionCookie(event, token)
  // The one place an actual sign-in happens. Sessions carry no `created_at`, so
  // without this the site could say who was *here* on a day and never how many
  // of them had signed in on it.
  touchAccountDay(row.id, true)
  return { username: row.username, role: row.role }
})

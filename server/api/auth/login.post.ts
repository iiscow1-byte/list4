import { getDb } from '~/server/db'
import { verifyPassword, createSession, setSessionCookie } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')

  const db = getDb()
  const row = db.prepare(
    `SELECT id, username, password_hash, password_salt, role
       FROM accounts WHERE username = ? COLLATE NOCASE`,
  ).get(username) as any
  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid username or password.' })
  }
  const token = createSession(row.id)
  setSessionCookie(event, token)
  return { username: row.username, role: row.role }
})

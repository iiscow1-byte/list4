import { getDb } from '~/server/db'
import { hashPassword, createSession, setSessionCookie } from '~/server/utils/auth'

const BOOTSTRAP_ADMIN = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'Gerg').toLowerCase()

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
    throw createError({ statusCode: 400, statusMessage: 'Username must be 3–32 characters: letters, numbers, underscore, or hyphen.' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters.' })
  }

  const db = getDb()
  const existing = db.prepare(`SELECT id FROM accounts WHERE username = ? COLLATE NOCASE`).get(username)
  if (existing) throw createError({ statusCode: 409, statusMessage: 'Username already taken.' })

  const { hash, salt } = hashPassword(password)
  const role = username.toLowerCase() === BOOTSTRAP_ADMIN ? 'admin' : 'user'
  const result = db.prepare(
    `INSERT INTO accounts (username, password_hash, password_salt, role) VALUES (?, ?, ?, ?)`,
  ).run(username, hash, salt, role)

  const token = createSession(Number(result.lastInsertRowid))
  setSessionCookie(event, token)
  return { username, role }
})

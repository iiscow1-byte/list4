import { LOCKDOWN_HEADLINE } from '~/utils/lockdown'
import { getDb } from '~/server/db'
import { hashPassword, createSession, setSessionCookie } from '~/server/utils/auth'
import { SIGNUPS_ENABLED } from '~/server/utils/site-access'
import { assertClean } from '~/server/utils/profanity-guard'
import { touchAccountDay } from '~/server/utils/analytics'

const BOOTSTRAP_ADMIN = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'Gerg').toLowerCase()

export default defineEventHandler(async (event) => {
  // Closed here, not just hidden in the UI — the form is one `curl` away.
  // Admin accounts are created with `npm run make-admin` while this is off.
  if (!SIGNUPS_ENABLED) {
    throw createError({
      statusCode: 403,
      statusMessage: `Account creation is closed. ${LOCKDOWN_HEADLINE}`,
    })
  }

  const body = await readBody(event)
  const username = String(body?.username ?? '').trim()
  const password = String(body?.password ?? '')
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
    throw createError({ statusCode: 400, statusMessage: 'Username must be 3–32 characters: letters, numbers, underscore, or hyphen.' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters.' })
  }
  // A username isn't a message — it appears beside every record its owner holds,
  // in the leaderboard and in other people's inboxes, with no way to opt out.
  assertClean(username, 'Usernames')

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
  // Signing up ends with a session, so it is a sign-in on the day it happened.
  touchAccountDay(Number(result.lastInsertRowid), true)
  return { username, role }
})

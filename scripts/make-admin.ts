/**
 * Create or promote an admin account.
 *
 * With sign-ups closed this is the only way an account comes into existence, so
 * it is also the recovery path if the last admin is ever lost. Deliberately a
 * local CLI rather than a route: an HTTP endpoint that mints admins is a back
 * door no matter how it's guarded.
 *
 *   npm run make-admin -- --username Gerg --password 'something long'
 *   npm run make-admin -- --username Gerg --role owner      # promote existing
 *   npm run make-admin -- --list                            # who has access
 *
 * Reads LIST_DB_PATH like the rest of the server, so pointing it at a
 * production database is `LIST_DB_PATH=/srv/list.db npm run make-admin -- …`.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { hashPassword } from '../server/utils/password.ts'

const VALID_ROLES = ['admin', 'owner', 'developer', 'moderator', 'user'] as const
type Role = (typeof VALID_ROLES)[number]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')) {
    return process.argv[i + 1]
  }
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

const DB_PATH = process.env.LIST_DB_PATH || resolve(process.cwd(), 'data', 'list.db')
if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set LIST_DB_PATH or run from the project root.`)
  process.exit(1)
}

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

type AccountRow = { id: number; username: string; role: string; created_at: string }

if (has('list')) {
  const rows = db.prepare(
    `SELECT id, username, role, created_at FROM accounts
      WHERE role <> 'user' ORDER BY created_at ASC`,
  ).all() as AccountRow[]
  if (!rows.length) {
    console.log('No staff accounts exist. Nobody can sign in while the site is locked down.')
    console.log("Create one:  npm run make-admin -- --username <name> --password '<password>'")
  } else {
    console.log(`${rows.length} staff account(s):`)
    for (const r of rows) console.log(`  ${r.role.padEnd(10)} ${r.username}  (created ${r.created_at})`)
  }
  process.exit(0)
}

const username = (arg('username') ?? '').trim()
const password = arg('password') ?? ''
const role = (arg('role') ?? 'admin') as Role

if (!username) {
  console.error("Usage: npm run make-admin -- --username <name> [--password '<password>'] [--role admin]")
  console.error('       npm run make-admin -- --list')
  process.exit(1)
}
if (!VALID_ROLES.includes(role)) {
  console.error(`--role must be one of: ${VALID_ROLES.join(', ')}`)
  process.exit(1)
}
if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
  console.error('Username must be 3–32 characters: letters, numbers, underscore, or hyphen.')
  process.exit(1)
}

const existing = db.prepare(
  `SELECT id, username, role FROM accounts WHERE username = ? COLLATE NOCASE`,
).get(username) as { id: number; username: string; role: string } | undefined

if (existing) {
  // Promote, and optionally reset the password. Both are stated explicitly so
  // "it did nothing" and "it changed the password too" are distinguishable.
  const changes: string[] = []
  if (existing.role !== role) {
    db.prepare(`UPDATE accounts SET role = ? WHERE id = ?`).run(role, existing.id)
    changes.push(`role ${existing.role} → ${role}`)
  }
  if (password) {
    if (password.length < 8) {
      console.error('Password must be at least 8 characters.')
      process.exit(1)
    }
    const { hash, salt } = hashPassword(password)
    db.prepare(`UPDATE accounts SET password_hash = ?, password_salt = ? WHERE id = ?`)
      .run(hash, salt, existing.id)
    // Existing sessions keep working after a password change unless we say
    // otherwise; on a recovery path that is the wrong default.
    const dropped = db.prepare(`DELETE FROM sessions WHERE account_id = ?`).run(existing.id)
    changes.push(`password reset (${dropped.changes} session(s) signed out)`)
  }
  if (!changes.length) {
    console.log(`${existing.username} is already ${role}. Nothing to do.`)
    console.log('Pass --password to reset it as well.')
  } else {
    console.log(`Updated ${existing.username}: ${changes.join('; ')}.`)
  }
} else {
  if (!password) {
    console.error(`No account named "${username}". Pass --password to create one.`)
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.')
    process.exit(1)
  }
  const { hash, salt } = hashPassword(password)
  const res = db.prepare(
    `INSERT INTO accounts (username, password_hash, password_salt, role) VALUES (?, ?, ?, ?)`,
  ).run(username, hash, salt, role)
  console.log(`Created ${username} (${role}), account id ${res.lastInsertRowid}.`)
}

const staff = db.prepare(
  `SELECT COUNT(*) AS n FROM accounts WHERE role IN ('admin','owner','developer')`,
).get() as { n: number }
console.log(`${staff.n} account(s) can now sign in while the site is locked down.`)

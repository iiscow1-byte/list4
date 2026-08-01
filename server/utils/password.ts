import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing, kept in its own module with no aliased imports.
 *
 * `auth.ts` re-exports both of these, so server code carries on importing them
 * from there. The separation exists so the `make-admin` script can import the
 * real functions with a plain relative path — a standalone script can't resolve
 * `~/server/db`, and reimplementing scrypt in the script is how a bootstrap
 * tool ends up writing hashes the login endpoint rejects.
 */

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const test = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (test.length !== expected.length) return false
  return timingSafeEqual(test, expected)
}

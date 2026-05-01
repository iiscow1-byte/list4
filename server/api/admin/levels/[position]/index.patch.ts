import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

const FIELDS: Record<string, 'text' | 'int' | 'real'> = {
  name: 'text',
  gd_id: 'int',
  creator: 'text',
  verifier: 'text',
  publisher: 'text',
  enjoyment: 'real',
  points: 'real',
  difficulty: 'text',
  gddl_tier: 'text',
  rated: 'text',
  main_skillset: 'text',
  verification: 'text',
  verification_url: 'text',
  year_verified: 'int',
  description_override: 'text',
}

function coerce(value: unknown, type: 'text' | 'int' | 'real'): string | number | null {
  if (value === undefined || value === null || value === '') return null
  if (type === 'text') {
    const s = String(value).trim()
    return s === '' ? null : s
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return type === 'int' ? Math.trunc(n) : n
}

/**
 * Edit a permanent level's metadata. Mods or admins; level must be permanent.
 */
// Fields only an admin can write — mods edit metadata but description override
// is editorial, so admin-only.
const ADMIN_ONLY_FIELDS = new Set(['description_override'])

export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position)) throw createError({ statusCode: 400, statusMessage: 'Bad position' })

  const body = (await readBody(event)) ?? {}
  const db = getDb()
  const existing = db.prepare(`SELECT permanent FROM levels WHERE position = ?`).get(position) as { permanent: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such level.' })
  if (!existing.permanent) {
    throw createError({ statusCode: 400, statusMessage: 'Promote the level to permanent before editing.' })
  }

  const sets: string[] = []
  const values: (string | number | null)[] = []
  for (const [key, type] of Object.entries(FIELDS)) {
    if (!(key in body)) continue
    if (ADMIN_ONLY_FIELDS.has(key) && account.role !== 'admin') continue
    sets.push(`${key} = ?`)
    values.push(coerce(body[key], type))
  }
  if (sets.length === 0) return { ok: true, updated: 0 }

  values.push(position)
  db.prepare(`UPDATE levels SET ${sets.join(', ')} WHERE position = ?`).run(...values)
  return { ok: true, updated: sets.length }
})

import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

const FIELDS: Record<string, 'text' | 'int' | 'real'> = {
  name: 'text',
  gd_id: 'int',
  verify_date: 'text',
  days: 'int',
  demon_ranking: 'text',
  placement_source: 'text',
  verification: 'text',
  verification_url: 'text',
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
 * Edit a void-list level's metadata. Mods or admins.
 */
export default defineEventHandler(async (event) => {
  requireMod(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isInteger(position) || position <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad position' })
  }

  const body = (await readBody(event)) ?? {}
  const db = getDb()
  const existing = db.prepare(`SELECT id FROM void_levels WHERE position = ?`).get(position) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such void level.' })

  const sets: string[] = []
  const values: (string | number | null)[] = []
  for (const [key, type] of Object.entries(FIELDS)) {
    if (!(key in body)) continue
    sets.push(`${key} = ?`)
    values.push(coerce(body[key], type))
  }
  if (sets.length === 0) return { ok: true, updated: 0 }

  values.push(position)
  db.prepare(`UPDATE void_levels SET ${sets.join(', ')} WHERE position = ?`).run(...values)

  return { ok: true, updated: sets.length }
})

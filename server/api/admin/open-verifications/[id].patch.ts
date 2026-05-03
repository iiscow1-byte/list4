import { getDb } from '~/server/db'
import { requireMod } from '~/server/utils/auth'

const FIELDS: Record<string, 'text' | 'int' | 'real'> = {
  name: 'text',
  gd_id: 'int',
  fps: 'text',
  game_version: 'text',
  showcase_url: 'text',
  verifier: 'text',
  gddl_tier: 'text',
  difficulty: 'text',
  enjoyment: 'real',
  main_skillset: 'text',
  tags: 'text',
  notes: 'text',
  placement_source: 'text',
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
 * Edit an open-verification's metadata. Mods or admins.
 */
export default defineEventHandler(async (event) => {
  requireMod(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  }

  const body = (await readBody(event)) ?? {}
  const db = getDb()
  const existing = db.prepare(`SELECT id FROM open_verifications WHERE id = ?`).get(id) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such open verification.' })

  const sets: string[] = []
  const values: (string | number | null)[] = []
  for (const [key, type] of Object.entries(FIELDS)) {
    if (!(key in body)) continue
    sets.push(`${key} = ?`)
    values.push(coerce(body[key], type))
  }
  if (sets.length === 0) return { ok: true, updated: 0 }

  values.push(id)
  db.prepare(`UPDATE open_verifications SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  return { ok: true, updated: sets.length }
})

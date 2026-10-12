import { getDb } from '~/server/db'
import { requireMod, isAdminRole } from '~/server/utils/auth'
import { SHEET_FIELDS, addSiteFields, afterListChange, parseSiteFields, tx } from '~/server/utils/list-ops'
import { logActivity } from '~/server/utils/activity-log'
import { isValidTier } from '~/utils/tier-ordinal'

// `points` is derived from tier + position and isn't editable.
const FIELDS: Record<string, 'text' | 'int' | 'real' | 'bool'> = {
  name: 'text',
  gd_id: 'int',
  creator: 'text',
  verifier: 'text',
  publisher: 'text',
  enjoyment: 'real',
  difficulty: 'text',
  gddl_tier: 'text',
  rated: 'text',
  placement_source: 'text',
  main_skillset: 'text',
  verification: 'text',
  verification_url: 'text',
  verify_date: 'text',
  year_verified: 'int',
  description_override: 'text',
  same_as_above: 'bool',
  duplicate_of_id: 'int',
  is_alternate: 'bool',
  alternate_of_id: 'int',
  tentative_placement: 'bool',
}

const ADMIN_ONLY_FIELDS = new Set(['description_override'])

function coerce(value: unknown, type: 'text' | 'int' | 'real' | 'bool'): string | number | null {
  if (type === 'bool') return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
  if (value === undefined || value === null || value === '') return null
  if (type === 'text') {
    const s = String(value).trim()
    return s === '' ? null : s
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return type === 'int' ? Math.trunc(n) : n
}

/** `tier 25`, `T25`, `25` → `Tier 25`; `s4` → `Subtier 4`. */
function normaliseTier(raw: string): string | null {
  if (isValidTier(raw)) return raw
  const t = raw.trim()
  const sub = t.match(/^s(?:ub)?\s*-?\s*(?:tier)?\s*(\d)$/i)
  if (sub && Number(sub[1]) <= 5) return `Subtier ${Number(sub[1])}`
  const tier = t.match(/^t(?:ier)?\s*(\d{1,2})$/i) ?? t.match(/^(\d{1,2})$/)
  if (tier && isValidTier(`Tier ${Number(tier[1])}`)) return `Tier ${Number(tier[1])}`
  return null
}

/**
 * Edit a level's details. Any level can be edited; a change to a column the
 * sheet also supplies is remembered, so the next refresh leaves it alone.
 */
export default defineEventHandler(async (event) => {
  const account = requireMod(event)
  const position = Number(getRouterParam(event, 'position'))
  if (!Number.isFinite(position)) throw createError({ statusCode: 400, statusMessage: 'Bad position' })

  const body = (await readBody(event)) ?? {}
  const db = getDb()
  const existing = db.prepare(`SELECT * FROM levels WHERE position = ?`).get(position) as Record<string, any> | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  const sets: string[] = []
  const values: (string | number | null)[] = []
  const changed: string[] = []
  for (const [key, type] of Object.entries(FIELDS)) {
    if (!(key in body)) continue
    if (ADMIN_ONLY_FIELDS.has(key) && !isAdminRole(account.role)) continue
    let value = coerce(body[key], type)
    if (key === 'name') {
      if (!value) throw createError({ statusCode: 400, statusMessage: 'A level needs a name.' })
      if (String(value).includes(',')) throw createError({ statusCode: 400, statusMessage: 'Level names cannot contain commas.' })
    }
    if (key === 'gddl_tier' && value != null) {
      const tier = normaliseTier(String(value))
      if (!tier) throw createError({ statusCode: 400, statusMessage: `"${value}" isn't a tier. Use "Tier 1"–"Tier 45" or "Subtier 0"–"Subtier 5".` })
      value = tier
    }
    if (key === 'enjoyment' && value != null && (Number(value) < 0 || Number(value) > 10)) {
      throw createError({ statusCode: 400, statusMessage: 'Enjoyment is 0 to 10.' })
    }
    if ((existing[key] ?? null) === value) continue
    sets.push(`${key} = ?`)
    values.push(value)
    changed.push(key)
  }
  if (!sets.length) return { ok: true, updated: 0, site_fields: [...parseSiteFields(existing.site_fields)] }

  tx(db, () => {
    db.prepare(`UPDATE levels SET ${sets.join(', ')} WHERE id = ?`).run(...values, existing.id)
    addSiteFields(db, existing.id, changed.filter((k) => (SHEET_FIELDS as readonly string[]).includes(k)))
  })
  afterListChange(db, { points: changed.includes('gddl_tier') || changed.includes('same_as_above') })

  logActivity({
    kind: 'level.edit',
    area: 'levels',
    severity: 'info',
    actor: account,
    subject: { kind: 'level', id: existing.id, label: existing.name },
    summary: `Edited ${existing.name}: ${changed.join(', ')}`,
    detail: Object.fromEntries(changed.map((k) => [k, { from: existing[k] ?? null, to: values[changed.indexOf(k)] }])),
  }, db)

  const after = db.prepare(`SELECT site_fields FROM levels WHERE id = ?`).get(existing.id) as { site_fields: string | null }
  return { ok: true, updated: changed.length, site_fields: [...parseSiteFields(after.site_fields)] }
})

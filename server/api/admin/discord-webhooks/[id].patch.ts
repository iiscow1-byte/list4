import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'

/** Toggle a webhook's `active` flag, or rename its label. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }

  const body = (await readBody<{ active?: boolean; label?: string | null }>(event)) ?? {}
  const sets: string[] = []
  const values: (string | number | null)[] = []
  if (typeof body.active === 'boolean') {
    sets.push('active = ?')
    values.push(body.active ? 1 : 0)
  }
  if ('label' in body) {
    const v = body.label != null ? String(body.label).trim().slice(0, 100) || null : null
    sets.push('label = ?')
    values.push(v)
  }
  if (!sets.length) return { ok: true, updated: 0 }

  const db = getDb()
  const existing = db.prepare(`SELECT id FROM discord_webhooks WHERE id = ?`).get(id) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Webhook not found.' })

  values.push(id)
  db.prepare(`UPDATE discord_webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return { ok: true, updated: sets.length }
})

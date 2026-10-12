import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { startCursorNow } from '~/server/utils/daily-discord'

const VALID_KINDS = new Set(['changes', 'leaderboard', 'level_status', 'challenge_changes'])

/** Toggle a webhook's `active` flag, rename its label, or change its kind. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }

  const body = (await readBody<{ active?: boolean; label?: string | null; tier_emoji?: boolean; split_long?: boolean; kind?: string }>(event)) ?? {}
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
  if (typeof body.tier_emoji === 'boolean') {
    sets.push('tier_emoji = ?')
    values.push(body.tier_emoji ? 1 : 0)
  }
  if (typeof body.split_long === 'boolean') {
    sets.push('split_long = ?')
    values.push(body.split_long ? 1 : 0)
  }
  if (typeof body.kind === 'string' && VALID_KINDS.has(body.kind)) {
    sets.push('kind = ?')
    values.push(body.kind)
  }
  if (!sets.length) return { ok: true, updated: 0 }

  const db = getDb()
  const existing = db.prepare(`SELECT id, active, kind FROM discord_webhooks WHERE id = ?`).get(id) as { id: number; active: number; kind: string } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Webhook not found.' })

  values.push(id)
  db.prepare(`UPDATE discord_webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  // Switched back on, or switched to a different feed: start from now rather
  // than catching up on what it missed while off.
  if ((body.active === true && !existing.active) || (body.kind && body.kind !== existing.kind)) startCursorNow(db, id)
  return { ok: true, updated: sets.length }
})

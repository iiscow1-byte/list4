import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { isValidDiscordWebhook } from '~/server/utils/discord'

export default defineEventHandler(async (event) => {
  const account = requireAdmin(event)
  const body = await readBody<{ url?: string; label?: string }>(event)
  const url = String(body.url ?? '').trim()
  const label = body.label != null ? String(body.label).trim().slice(0, 100) || null : null

  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'A webhook URL is required.' })
  }
  if (!isValidDiscordWebhook(url)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Not a valid Discord webhook URL (expected https://discord.com/api/webhooks/<id>/<token>).',
    })
  }

  const db = getDb()
  const dupe = db.prepare(`SELECT id FROM discord_webhooks WHERE url = ?`).get(url) as { id: number } | undefined
  if (dupe) {
    throw createError({ statusCode: 409, statusMessage: 'That webhook is already registered.' })
  }

  const result = db
    .prepare(
      `INSERT INTO discord_webhooks (url, label, created_by) VALUES (?, ?, ?)`,
    )
    .run(url, label, account.id)

  return { ok: true, id: Number(result.lastInsertRowid) }
})

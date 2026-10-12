import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { buildTestEmbed, postToDiscordWebhook } from '~/server/utils/discord'

/** Send a test post, saying what the channel will receive, to check the webhook works. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }
  const db = getDb()
  const wh = db.prepare(`SELECT url, kind FROM discord_webhooks WHERE id = ?`).get(id) as { url: string; kind: string } | undefined
  if (!wh) throw createError({ statusCode: 404, statusMessage: 'Webhook not found.' })

  const res = await postToDiscordWebhook(wh.url, buildTestEmbed(wh.kind))
  db.prepare(`UPDATE discord_webhooks SET last_post_status = ? WHERE id = ?`).run(`test: ${res.status}`, id)
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: res.status })
  }
  return { ok: true }
})

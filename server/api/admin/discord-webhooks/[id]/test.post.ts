import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { buildTestEmbed, postToDiscordWebhook, withRoleMention } from '~/server/utils/discord'
import { recordDelivery } from '~/server/utils/discord-deliveries'

/**
 * Send a test post, saying what the channel will receive, to check the webhook
 * works. It pings the webhook's role too, so the role can be checked as well.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }
  const db = getDb()
  const wh = db.prepare(`SELECT url, kind, mention_role_id FROM discord_webhooks WHERE id = ?`).get(id) as
    { url: string; kind: string; mention_role_id: string | null } | undefined
  if (!wh) throw createError({ statusCode: 404, statusMessage: 'Webhook not found.' })

  const res = await postToDiscordWebhook(wh.url, withRoleMention(buildTestEmbed(wh.kind), wh.mention_role_id))
  db.prepare(`UPDATE discord_webhooks SET last_post_status = ? WHERE id = ?`).run(`test: ${res.status}`, id)
  recordDelivery(db, id, 'Test post', res)
  if (!res.ok) {
    throw createError({ statusCode: 502, statusMessage: res.gone ? 'Discord says this webhook no longer exists. It has been paused.' : res.status })
  }
  return { ok: true }
})

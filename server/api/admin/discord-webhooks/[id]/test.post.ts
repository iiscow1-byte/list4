import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { postToDiscordWebhook } from '~/server/utils/discord'

/** Send a one-line "test" message to verify the webhook is alive. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }
  const db = getDb()
  const wh = db.prepare(`SELECT url FROM discord_webhooks WHERE id = ?`).get(id) as { url: string } | undefined
  if (!wh) throw createError({ statusCode: 404, statusMessage: 'Webhook not found.' })

  const status = await postToDiscordWebhook(wh.url, {
    content: 'Test message from The All Levels List.',
  })
  db.prepare(`UPDATE discord_webhooks SET last_post_status = ? WHERE id = ?`).run(`test: ${status}`, id)
  if (status !== 'ok') {
    throw createError({ statusCode: 502, statusMessage: status })
  }
  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'

/**
 * A list's webhooks. Editors only — a Discord webhook URL is a write
 * credential for that channel, so it never reaches a non-editor. The URL is
 * returned masked; the full value is write-only.
 */
export default defineEventHandler((event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list.' })
  }

  const hooks = db.prepare(
    `SELECT id, url, label, active, on_changes, on_records, on_submissions, last_status, created_at
       FROM custom_list_webhooks WHERE list_id = ? ORDER BY id ASC`,
  ).all(list.id) as any[]

  return {
    webhooks: hooks.map((h) => ({
      ...h,
      // Enough to tell two hooks apart, not enough to post to one.
      url: maskWebhook(h.url),
    })),
  }
})

function maskWebhook(url: string): string {
  const m = url.match(/\/webhooks\/(\d+)\//)
  return m ? `discord.com/api/webhooks/${m[1]}/…` : 'discord webhook'
}

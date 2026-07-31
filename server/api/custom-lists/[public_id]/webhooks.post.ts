import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { isValidDiscordWebhook, notifyListWebhooks } from '~/server/utils/custom-list-webhooks'

const MAX_WEBHOOKS = 5

/** Add a Discord webhook to a list, or test/remove an existing one. */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{
    action?: 'create' | 'update' | 'delete' | 'test'
    id?: number
    url?: string
    label?: string
    active?: boolean
    on_changes?: boolean
    on_records?: boolean
    on_submissions?: boolean
  }>(event)

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, title FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number; title: string } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, list, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list.' })
  }

  const action = body?.action ?? 'create'
  const own = (id: number) => db.prepare(
    `SELECT id FROM custom_list_webhooks WHERE id = ? AND list_id = ?`,
  ).get(id, list.id)

  if (action === 'create') {
    const url = String(body?.url ?? '').trim()
    if (!isValidDiscordWebhook(url)) {
      throw createError({ statusCode: 400, statusMessage: 'That is not a Discord webhook URL.' })
    }
    const count = (db.prepare(
      `SELECT COUNT(*) AS n FROM custom_list_webhooks WHERE list_id = ?`,
    ).get(list.id) as { n: number }).n
    if (count >= MAX_WEBHOOKS) {
      throw createError({ statusCode: 400, statusMessage: `A list can have at most ${MAX_WEBHOOKS} webhooks.` })
    }
    db.prepare(
      `INSERT INTO custom_list_webhooks
         (list_id, url, label, on_changes, on_records, on_submissions, created_by)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      list.id, url,
      String(body?.label ?? '').trim().slice(0, 80) || null,
      body?.on_changes === false ? 0 : 1,
      body?.on_records === false ? 0 : 1,
      body?.on_submissions ? 1 : 0,
      account.id,
    )
    return { ok: true }
  }

  const id = Number(body?.id)
  if (!Number.isInteger(id) || !own(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }

  if (action === 'delete') {
    db.prepare(`DELETE FROM custom_list_webhooks WHERE id = ?`).run(id)
    return { ok: true }
  }

  if (action === 'test') {
    // Temporarily force every flag on so the test always reaches this hook.
    const row = db.prepare(`SELECT url FROM custom_list_webhooks WHERE id = ?`).get(id) as { url: string }
    try {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `Test from ${list.title}`,
            description: `Sent by ${account.username}. If you can read this, the webhook works.`,
            color: 0xf4c430,
            timestamp: new Date().toISOString(),
          }],
        }),
        signal: AbortSignal.timeout(8000),
      })
      db.prepare(`UPDATE custom_list_webhooks SET last_status = ? WHERE id = ?`)
        .run(res.ok ? 'ok' : `HTTP ${res.status}`, id)
      if (!res.ok) throw createError({ statusCode: 502, statusMessage: `Discord replied ${res.status}.` })
      return { ok: true }
    } catch (err: any) {
      if (err?.statusCode) throw err
      db.prepare(`UPDATE custom_list_webhooks SET last_status = ? WHERE id = ?`)
        .run(String(err?.message ?? 'failed').slice(0, 120), id)
      throw createError({ statusCode: 502, statusMessage: 'Could not reach that webhook.' })
    }
  }

  // update
  const sets: string[] = []
  const params: any[] = []
  for (const [key, col] of [
    ['active', 'active'], ['on_changes', 'on_changes'],
    ['on_records', 'on_records'], ['on_submissions', 'on_submissions'],
  ] as const) {
    if (typeof (body as any)[key] === 'boolean') {
      sets.push(`${col} = ?`)
      params.push((body as any)[key] ? 1 : 0)
    }
  }
  if (typeof body?.label === 'string') {
    sets.push('label = ?')
    params.push(body.label.trim().slice(0, 80) || null)
  }
  if (sets.length) {
    db.prepare(`UPDATE custom_list_webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
  }
  return { ok: true }
})

import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { fetchWebhookInfo, isValidDiscordWebhook, parseRoleId } from '~/server/utils/discord'
import { startCursorNow } from '~/server/utils/daily-discord'
import { logActivity } from '~/server/utils/activity-log'

const VALID_KINDS = new Set(['changes', 'leaderboard', 'level_status', 'challenge_changes'])

export default defineEventHandler(async (event) => {
  const account = requireAdmin(event)
  const body = await readBody<{
    url?: string; label?: string; kind?: string
    mention_role_id?: string | null; tier_emoji?: boolean; split_long?: boolean
  }>(event)
  const url = String(body.url ?? '').trim()
  let label = body.label != null ? String(body.label).trim().slice(0, 100) || null : null
  const kind = (typeof body.kind === 'string' && VALID_KINDS.has(body.kind)) ? body.kind : 'changes'
  const roleRaw = body.mention_role_id != null ? String(body.mention_role_id).trim() : ''
  const role = roleRaw ? parseRoleId(roleRaw) : null
  if (roleRaw && !role) {
    throw createError({ statusCode: 400, statusMessage: 'That isn’t a role ID. In Discord, right-click the role and choose Copy Role ID.' })
  }

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

  // Ask Discord before saving. A URL copied from a deleted webhook is the
  // common mistake, and it used to be accepted and then fail every night.
  const info = await fetchWebhookInfo(url)
  if (info.gone) {
    throw createError({ statusCode: 400, statusMessage: 'Discord says this webhook doesn’t exist. Copy the URL again from the channel’s Integrations settings.' })
  }
  if (!label && info.name) label = info.name.slice(0, 100)

  const result = db
    .prepare(
      `INSERT INTO discord_webhooks (url, label, kind, created_by, mention_role_id, tier_emoji, split_long, discord_name, channel_id, guild_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(url, label, kind, account.id, role, body.tier_emoji ? 1 : 0, body.split_long ? 1 : 0, info.name, info.channel_id, info.guild_id)

  const id = Number(result.lastInsertRowid)
  // A new webhook gets what happens from now on, not the backlog.
  startCursorNow(db, id)
  logActivity({
    kind: 'discord.add',
    area: 'system',
    severity: 'notable',
    actor: account,
    subject: { kind: 'webhook', id, label: label ?? info.name ?? 'Discord webhook' },
    summary: `Added a Discord webhook (${kind}): ${label ?? info.name ?? 'unnamed'}`,
  }, db)
  return { ok: true, id, verified: info.ok, discord_name: info.name }
})

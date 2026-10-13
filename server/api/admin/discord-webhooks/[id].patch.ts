import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { startCursorNow } from '~/server/utils/daily-discord'
import { fetchWebhookInfo, isValidDiscordWebhook, parseRoleId } from '~/server/utils/discord'
import { logActivity } from '~/server/utils/activity-log'

const VALID_KINDS = new Set(['changes', 'leaderboard', 'level_status', 'challenge_changes'])

/** Columns an admin sets, as the log names them. The rest follow from these. */
const SETTING_NAMES: Record<string, string> = {
  active: 'on/off', label: 'name', tier_emoji: 'tier emoji', split_long: 'send every change',
  kind: 'what it posts', mention_role_id: 'role ping', url: 'new URL',
}

/**
 * Change a webhook: switch it on or off, rename it, change what it posts, set
 * the role it pings, or give it a new URL.
 *
 * A new URL keeps the webhook's history and its place in the digest, so a
 * channel whose webhook was regenerated picks up where it stopped instead of
 * being removed and added again.
 */
export default defineEventHandler(async (event) => {
  const me = requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }

  const body = (await readBody<{
    active?: boolean; label?: string | null; tier_emoji?: boolean; split_long?: boolean; kind?: string
    mention_role_id?: string | null; url?: string
  }>(event)) ?? {}

  const db = getDb()
  const existing = db.prepare(`SELECT id, active, kind, url, label FROM discord_webhooks WHERE id = ?`).get(id) as
    { id: number; active: number; kind: string; url: string; label: string | null } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Webhook not found.' })

  const sets: string[] = []
  const values: (string | number | null)[] = []
  const set = (col: string, v: string | number | null) => { sets.push(`${col} = ?`); values.push(v) }

  if (typeof body.active === 'boolean') {
    set('active', body.active ? 1 : 0)
    if (body.active) set('paused_reason', null)
  }
  if ('label' in body) {
    set('label', body.label != null ? String(body.label).trim().slice(0, 100) || null : null)
  }
  if (typeof body.tier_emoji === 'boolean') set('tier_emoji', body.tier_emoji ? 1 : 0)
  if (typeof body.split_long === 'boolean') set('split_long', body.split_long ? 1 : 0)
  if (typeof body.kind === 'string' && VALID_KINDS.has(body.kind)) set('kind', body.kind)
  if ('mention_role_id' in body) {
    const raw = body.mention_role_id != null ? String(body.mention_role_id).trim() : ''
    const role = raw ? parseRoleId(raw) : null
    if (raw && !role) {
      throw createError({ statusCode: 400, statusMessage: 'That isn’t a role ID. In Discord, right-click the role and choose Copy Role ID.' })
    }
    set('mention_role_id', role)
  }

  let replacedUrl = false
  if (typeof body.url === 'string' && body.url.trim() && body.url.trim() !== existing.url) {
    const url = body.url.trim()
    if (!isValidDiscordWebhook(url)) {
      throw createError({ statusCode: 400, statusMessage: 'Not a valid Discord webhook URL (expected https://discord.com/api/webhooks/<id>/<token>).' })
    }
    const dupe = db.prepare(`SELECT id FROM discord_webhooks WHERE url = ? AND id <> ?`).get(url, id)
    if (dupe) throw createError({ statusCode: 409, statusMessage: 'That webhook is already registered.' })
    const info = await fetchWebhookInfo(url)
    if (info.gone) {
      throw createError({ statusCode: 400, statusMessage: 'Discord says this webhook doesn’t exist. Copy the URL again from the channel’s Integrations settings.' })
    }
    set('url', url)
    set('discord_name', info.name)
    set('channel_id', info.channel_id)
    set('guild_id', info.guild_id)
    // A working URL is the fix for a webhook the site paused as gone.
    set('active', 1)
    set('paused_reason', null)
    set('fail_count', 0)
    replacedUrl = true
  }

  if (!sets.length) return { ok: true, updated: 0 }

  values.push(id)
  db.prepare(`UPDATE discord_webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  // Switched back on, or switched to a different feed: start from now rather
  // than catching up on what it missed while off. A new URL is a repair, not a
  // switch, so it keeps its cursor and gets what it missed.
  const resumed = body.active === true && !existing.active
  const rekinded = !!body.kind && body.kind !== existing.kind
  if ((resumed || rekinded) && !replacedUrl) startCursorNow(db, id)
  // Which settings changed, in words; never the URL itself, which is a credential.
  const changed = sets.map((s) => SETTING_NAMES[s.split(' ')[0]!]).filter(Boolean)
  logActivity({
    kind: 'discord.update',
    area: 'system',
    severity: replacedUrl || rekinded ? 'notable' : 'info',
    actor: me,
    subject: { kind: 'webhook', id, label: existing.label ?? 'Discord webhook' },
    summary: `Changed a Discord webhook (${existing.label ?? 'unnamed'}): ${[...new Set(changed)].join(', ')}`,
    detail: { active: body.active, kind: body.kind, replaced_url: replacedUrl || undefined },
  }, db)
  return { ok: true, updated: sets.length }
})

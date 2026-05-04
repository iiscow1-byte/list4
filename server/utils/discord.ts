import type { Change } from '~/server/utils/changes'

const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/+$/, '')
const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/

export function isValidDiscordWebhook(url: string): boolean {
  return DISCORD_WEBHOOK_PATTERN.test(url.trim())
}

function levelLink(name: string, position: number): string {
  if (!SITE_URL) return name
  // Discord-flavored markdown: title-case-friendly link.
  return `[${name}](${SITE_URL}/levels/${position})`
}

/**
 * Build the Discord embed payload for a single day's changes. Returns null
 * when the day has no changes — caller should skip the post.
 */
export function buildDailyEmbed(date: string, changes: Change[]): { embeds: unknown[] } | null {
  if (!changes.length) return null

  const adds = changes.filter((c) => c.kind === 'add')
  // Group moves by direction so the embed reads "promoted up" vs "demoted down".
  const movesUp: Change[] = []
  const movesDown: Change[] = []
  for (const c of changes) {
    if (c.kind !== 'move') continue
    if (c.from_position == null) continue
    if (c.to_position < c.from_position) movesUp.push(c)
    else movesDown.push(c)
  }

  const lines: string[] = []
  if (adds.length) {
    lines.push(`**Added (${adds.length})**`)
    for (const c of adds) {
      lines.push(`+ #${c.to_position} · ${levelLink(c.level_name, c.level_position)}`)
    }
    lines.push('')
  }
  if (movesUp.length) {
    lines.push(`**Moved up (${movesUp.length})**`)
    for (const c of movesUp) {
      lines.push(`▲ ${levelLink(c.level_name, c.level_position)}: #${c.from_position} → #${c.to_position}`)
    }
    lines.push('')
  }
  if (movesDown.length) {
    lines.push(`**Moved down (${movesDown.length})**`)
    for (const c of movesDown) {
      lines.push(`▼ ${levelLink(c.level_name, c.level_position)}: #${c.from_position} → #${c.to_position}`)
    }
  }

  // Discord embeds cap description at 4096 chars; truncate gracefully.
  let description = lines.join('\n').trim()
  if (description.length > 3900) {
    description = description.slice(0, 3900) + '\n…(truncated)'
  }

  return {
    embeds: [
      {
        title: `The All Levels List — Recent Changes for ${date}`,
        url: (SITE_URL && /^https?:\/\//.test(SITE_URL)) ? SITE_URL : undefined,
        description,
        color: 0xf4c430,
        footer: { text: `${changes.length} change${changes.length === 1 ? '' : 's'}` },
        timestamp: new Date(`${date}T23:59:59Z`).toISOString(),
      },
    ],
  }
}

/**
 * POST a payload to a Discord webhook. Returns a status string ("ok" or
 * "HTTP <code>" or an error message). Discord webhooks return 204 on success.
 */
export async function postToDiscordWebhook(
  url: string,
  payload: object,
  timeoutMs = 10_000,
): Promise<string> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (resp.status === 204 || resp.status === 200) return 'ok'
    const body = await resp.text().catch(() => '')
    return `HTTP ${resp.status}${body ? ` ${body.slice(0, 200)}` : ''}`
  } catch (e: any) {
    return `error: ${e?.message ?? 'unknown'}`
  }
}

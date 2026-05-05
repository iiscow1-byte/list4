import type { Change } from '~/server/utils/changes'

// Auto-prepend https:// if SITE_URL is set but has no scheme — Discord won't
// render markdown links with bare hostnames (no scheme) as clickable hyperlinks.
const _rawUrl = (process.env.SITE_URL ?? '').replace(/\/+$/, '')
const SITE_URL_VALID = _rawUrl
  ? (/^https?:\/\//.test(_rawUrl) ? _rawUrl : `https://${_rawUrl}`)
  : ''
const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/

export function isValidDiscordWebhook(url: string): boolean {
  return DISCORD_WEBHOOK_PATTERN.test(url.trim())
}

function levelLink(name: string, position: number): string {
  if (!SITE_URL_VALID) return name
  return `[${name}](${SITE_URL_VALID}/levels/${position})`
}

function tierEmojiStr(tier: string | null): string {
  if (!tier) return ''
  if (/^Subtier \d/.test(tier)) return ':tierunrated:'
  const t = tier.match(/^Tier (\d{1,2})$/)
  if (t) return `:tier${t[1]!.padStart(2, '0')}:`
  return ''
}

/**
 * Build the Discord embed payload for a single day's changes. Returns null
 * when the day has no changes — caller should skip the post.
 */
export function buildDailyEmbed(
  date: string,
  changes: Change[],
  opts: { tierEmoji?: boolean } = {},
): { embeds: unknown[] } | null {
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
      if (opts.tierEmoji) {
        const emoji = tierEmojiStr(c.level_gddl_tier)
        lines.push(`+ ${levelLink(c.level_name, c.level_position)}${emoji ? ` ${emoji}` : ''} #${c.to_position}`)
      } else {
        lines.push(`+ #${c.to_position} · ${levelLink(c.level_name, c.level_position)}`)
      }
    }
    lines.push('')
  }
  if (movesUp.length) {
    lines.push(`**Moved up (${movesUp.length})**`)
    for (const c of movesUp) {
      if (opts.tierEmoji) {
        const emoji = tierEmojiStr(c.level_gddl_tier)
        lines.push(`▲ ${levelLink(c.level_name, c.level_position)}${emoji ? ` ${emoji}` : ''} #${c.from_position} → #${c.to_position}`)
      } else {
        lines.push(`▲ ${levelLink(c.level_name, c.level_position)}: #${c.from_position} → #${c.to_position}`)
      }
    }
    lines.push('')
  }
  if (movesDown.length) {
    lines.push(`**Moved down (${movesDown.length})**`)
    for (const c of movesDown) {
      if (opts.tierEmoji) {
        const emoji = tierEmojiStr(c.level_gddl_tier)
        lines.push(`▼ ${levelLink(c.level_name, c.level_position)}${emoji ? ` ${emoji}` : ''} #${c.from_position} → #${c.to_position}`)
      } else {
        lines.push(`▼ ${levelLink(c.level_name, c.level_position)}: #${c.from_position} → #${c.to_position}`)
      }
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
        url: SITE_URL_VALID || undefined,
        description,
        color: 0xf4c430,
        footer: { text: `${changes.length} change${changes.length === 1 ? '' : 's'}` },
        timestamp: new Date(`${date}T23:59:59Z`).toISOString(),
      },
    ],
  }
}

/**
 * Build a Discord embed for a single record approval (leaderboard update).
 * Posts to webhooks with kind='leaderboard'.
 */
export function buildLeaderboardEmbed(opts: {
  playerName: string
  levelName: string
  levelPosition: number | null
  levelPoints: number | null
  playerTotal: number | null
  videoUrl: string | null
}): { embeds: unknown[] } {
  const { playerName, levelName, levelPosition, levelPoints, playerTotal, videoUrl } = opts
  const levelRef = (levelPosition && SITE_URL_VALID)
    ? `[${levelName}](${SITE_URL_VALID}/levels/${levelPosition})`
    : levelName
  const playerRef = SITE_URL_VALID
    ? `[${playerName}](${SITE_URL_VALID}/users/by-player/${encodeURIComponent(playerName)})`
    : playerName

  const lines: string[] = []
  if (levelPoints != null) lines.push(`**+${levelPoints.toLocaleString()} pts** from this level`)
  if (playerTotal != null) lines.push(`**${playerTotal.toLocaleString()} pts** total`)
  if (videoUrl) lines.push(`[Watch verification](${videoUrl})`)

  return {
    embeds: [{
      title: `${playerRef} completed ${levelRef}`,
      description: lines.join('\n') || null,
      color: 0x22c55e,
      timestamp: new Date().toISOString(),
      footer: { text: 'ALL Members Leaderboard' },
    }],
  }
}

/**
 * Build a Discord embed for a level status change (sent to awaiting or voided).
 * Posts to webhooks with kind='level_status'.
 */
export function buildLevelStatusEmbed(opts: {
  destination: 'awaiting' | 'void'
  levelName: string
  gddlTier: string | null
  difficulty: string | null
  submitter: string | null
  verificationUrl: string | null
  levelPosition?: number | null
}): { embeds: unknown[] } {
  const { destination, levelName, gddlTier, difficulty, submitter, verificationUrl, levelPosition } = opts

  const lines: string[] = []
  if (submitter) lines.push(`**Submitted by:** ${submitter}`)
  const meta: string[] = []
  if (gddlTier) meta.push(gddlTier)
  if (difficulty) meta.push(difficulty)
  if (meta.length) lines.push(`**Tier/Difficulty:** ${meta.join(' · ')}`)
  if (verificationUrl) lines.push(`[Verification video](${verificationUrl})`)

  const levelRef = (levelPosition && SITE_URL_VALID)
    ? `[${levelName}](${SITE_URL_VALID}/levels/${levelPosition})`
    : levelName

  const isAwaiting = destination === 'awaiting'
  return {
    embeds: [{
      title: `${levelRef} → ${isAwaiting ? 'Awaiting Placement' : 'Void List'}`,
      description: lines.join('\n') || null,
      color: isAwaiting ? 0x38bdf8 : 0xa855f7,
      timestamp: new Date().toISOString(),
      footer: { text: isAwaiting ? 'Awaiting Placement' : 'Void List' },
    }],
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

import type { Change } from '~/server/utils/changes'

export type WebhookKind = 'changes' | 'leaderboard' | 'level_status' | 'challenge_changes'

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
 *
 * Discord embed titles are plain text only — [markdown](links) render as
 * literal brackets. Clickable names go in `description` or `author`.
 */
export function buildLeaderboardEmbed(opts: {
  playerName: string
  levelName: string
  levelPosition: number | null
  levelPoints: number | null
  playerTotal: number | null
  videoUrl: string | null
  isVerification?: boolean
}): { embeds: unknown[] } {
  const { playerName, levelName, levelPosition, levelPoints, playerTotal, videoUrl, isVerification } = opts

  const levelUrl = (levelPosition && SITE_URL_VALID) ? `${SITE_URL_VALID}/levels/${levelPosition}` : null
  const playerUrl = SITE_URL_VALID ? `${SITE_URL_VALID}/users/by-player/${encodeURIComponent(playerName)}` : null

  // Only name and level are markdown links in the description; video is a
  // plain link for completions and omitted entirely for verifications.
  const levelRef = levelUrl ? `[${levelName}](${levelUrl})` : `**${levelName}**`
  const playerRef = playerUrl ? `[${playerName}](${playerUrl})` : `**${playerName}**`
  const verb = isVerification ? 'verified' : 'completed'

  const lines: string[] = [`${playerRef} ${verb} ${levelRef}`]
  if (levelPoints != null) lines.push(`**+${levelPoints.toLocaleString()} pts** from this level`)
  if (playerTotal != null) lines.push(`**${playerTotal.toLocaleString()} pts** total`)
  if (!isVerification && videoUrl) lines.push(`[watch completion](${videoUrl})`)

  return {
    embeds: [{
      title: `${playerName} ${verb} ${levelName}`,
      url: levelUrl ?? undefined,
      description: lines.join('\n'),
      color: 0x22c55e,
      timestamp: new Date().toISOString(),
      footer: { text: 'ALL Members Leaderboard' },
    }],
  }
}

/**
 * Build a Discord embed for a level status change (sent to awaiting or voided).
 * Posts to webhooks with kind='level_status'.
 *
 * Discord embed titles are plain text only — [markdown](links) render as
 * literal brackets. Use `url` to make the title clickable, and description
 * for the submitter's clickable name.
 */
export function buildLevelStatusEmbed(opts: {
  destination: 'awaiting' | 'void'
  levelName: string
  gddlTier: string | null
  difficulty: string | null
  submitter: string | null
  verificationUrl: string | null
  awaitingId?: number | null
  voidPosition?: number | null
}): { embeds: unknown[] } {
  const { destination, levelName, gddlTier, difficulty, submitter, verificationUrl, awaitingId, voidPosition } = opts
  const isAwaiting = destination === 'awaiting'

  // Title URL: link to the specific awaiting or void list item.
  let titleUrl: string | undefined
  if (SITE_URL_VALID) {
    if (isAwaiting && awaitingId) titleUrl = `${SITE_URL_VALID}/awaiting/${awaitingId}`
    else if (isAwaiting) titleUrl = `${SITE_URL_VALID}/awaiting`
    else if (voidPosition) titleUrl = `${SITE_URL_VALID}/void/${voidPosition}`
  }

  const lines: string[] = []
  if (submitter) {
    const submitterRef = SITE_URL_VALID
      ? `[${submitter}](${SITE_URL_VALID}/users/${encodeURIComponent(submitter)})`
      : `**${submitter}**`
    lines.push(`Submitted by ${submitterRef}`)
  }
  const meta: string[] = []
  if (gddlTier) meta.push(gddlTier)
  if (difficulty) meta.push(difficulty)
  if (meta.length) lines.push(`**Tier/Difficulty:** ${meta.join(' · ')}`)
  if (verificationUrl) lines.push(`[Verification video](${verificationUrl})`)

  return {
    embeds: [{
      // Title is plain text; url makes it clickable to the awaiting/void item.
      title: `${levelName} → ${isAwaiting ? 'Awaiting Placement' : 'Void List'}`,
      url: titleUrl,
      description: lines.join('\n') || null,
      color: isAwaiting ? 0x38bdf8 : 0xa855f7,
      timestamp: new Date().toISOString(),
      footer: { text: isAwaiting ? 'Awaiting Placement' : 'Void List' },
    }],
  }
}

/**
 * Build a Discord embed showing only challenge-rated level changes.
 * Positions are shown as challenge ranks (1 = hardest challenge on the list).
 * Returns null when there are no challenge changes for the day.
 */
export function buildChallengeEmbed(
  date: string,
  changes: Change[],
): { embeds: unknown[] } | null {
  const challengeChanges = changes.filter((c) => c.level_rated === 'Challenge')
  if (!challengeChanges.length) return null

  const adds = challengeChanges.filter((c) => c.kind === 'add')
  const movesUp = challengeChanges.filter((c) => c.kind === 'move' && c.from_position != null && c.to_position < c.from_position!)
  const movesDown = challengeChanges.filter((c) => c.kind === 'move' && c.from_position != null && c.to_position > c.from_position!)

  function chRank(rank: number | null, fallback: number): string {
    return rank != null ? `Ch. #${rank}` : `#${fallback}`
  }

  const lines: string[] = []
  if (adds.length) {
    lines.push(`**Added (${adds.length})**`)
    for (const c of adds) {
      lines.push(`+ ${chRank(c.challenge_rank, c.level_position)} · ${levelLink(c.level_name, c.level_position)}`)
    }
    lines.push('')
  }
  if (movesUp.length) {
    lines.push(`**Moved up (${movesUp.length})**`)
    for (const c of movesUp) {
      lines.push(`▲ ${levelLink(c.level_name, c.level_position)} ${chRank(c.from_challenge_rank, c.from_position ?? c.level_position)} → ${chRank(c.challenge_rank, c.level_position)}`)
    }
    lines.push('')
  }
  if (movesDown.length) {
    lines.push(`**Moved down (${movesDown.length})**`)
    for (const c of movesDown) {
      lines.push(`▼ ${levelLink(c.level_name, c.level_position)} ${chRank(c.from_challenge_rank, c.from_position ?? c.level_position)} → ${chRank(c.challenge_rank, c.level_position)}`)
    }
  }

  let description = lines.join('\n').trim()
  if (description.length > 3900) description = description.slice(0, 3900) + '\n…(truncated)'

  return {
    embeds: [{
      title: `Challenge Ranks — Recent Changes for ${date}`,
      url: SITE_URL_VALID || undefined,
      description,
      color: 0xf59e0b,
      footer: { text: `${challengeChanges.length} challenge change${challengeChanges.length === 1 ? '' : 's'}` },
      timestamp: new Date(`${date}T23:59:59Z`).toISOString(),
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

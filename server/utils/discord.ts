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

/**
 * Where the title of a changes post goes.
 *
 * The changelog, not the front page. The embed is a list of changes and the
 * page that holds all of them is the changelog — clicking through to the list
 * itself left you to find the day's changes yourself.
 */
const CHANGELOG_URL = SITE_URL_VALID ? `${SITE_URL_VALID}/changelog` : undefined

/**
 * Discord's own limit on an embed description, less a little room for the
 * "continued" header a split page may add back.
 */
const DESCRIPTION_LIMIT = 3900

/**
 * Break a day's lines into as many descriptions as it takes.
 *
 * Splitting happens on line boundaries only — half a level's entry in one
 * message and half in the next would be worse than the truncation this
 * replaces. A section heading (`**Moved up (40)**`) is repeated at the top of
 * the page that continues it, so a reader who only sees the third message can
 * still tell what they are looking at.
 *
 * Returns one page when it fits, which is the overwhelmingly common case.
 */
export function paginateLines(lines: string[], limit = DESCRIPTION_LIMIT): string[] {
  const pages: string[] = []
  let current: string[] = []
  let length = 0
  let heading: string | null = null

  const flush = () => {
    const text = current.join('\n').trim()
    if (text) pages.push(text)
    current = []
    length = 0
  }

  for (const line of lines) {
    if (line.startsWith('**')) heading = line
    // +1 for the newline this line will be joined with.
    if (length + line.length + 1 > limit && current.length) {
      flush()
      if (heading && heading !== line) {
        const cont = `${heading} (continued)`
        current.push(cont)
        length += cont.length + 1
      }
    }
    current.push(line)
    length += line.length + 1
  }
  flush()
  return pages.length ? pages : ['']
}

/** `Title` → `Title (2/3)`, only when there is more than one. */
function pageTitle(title: string, i: number, total: number): string {
  return total > 1 ? `${title} (${i + 1}/${total})` : title
}

function tierEmojiStr(tier: string | null): string {
  if (!tier) return ''
  if (/^Subtier \d/.test(tier)) return ':tierunrated:'
  const t = tier.match(/^Tier (\d{1,2})$/)
  if (t) return `:tier${t[1]!.padStart(2, '0')}:`
  return ''
}

/**
 * Build the Discord messages for a single day's changes.
 *
 * Returns an **array** of payloads: one on an ordinary day, more when the day
 * doesn't fit in one embed and the webhook has asked to be sent all of it
 * (`split`). Without that flag the behaviour is what it always was — the first
 * page, marked truncated — because posting six messages to a channel that
 * expected one is a change the channel's owner should opt into.
 *
 * Returns an empty array when the day has no changes; the caller skips it.
 */
export function buildDailyEmbeds(
  date: string,
  changes: Change[],
  opts: { tierEmoji?: boolean; split?: boolean } = {},
): { embeds: unknown[] }[] {
  if (!changes.length) return []

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

  const title = `The All Levels List — Recent Changes for ${date}`
  const count = `${changes.length} change${changes.length === 1 ? '' : 's'}`
  const pages = paginateLines(lines)

  // Not splitting: the first page, and an honest note that there was more.
  if (!opts.split && pages.length > 1) {
    return [{
      embeds: [{
        title,
        url: CHANGELOG_URL,
        description: `${pages[0]}\n…(truncated — turn on "Split long changelogs" to get the rest)`,
        color: 0xf4c430,
        footer: { text: count },
      }],
    }]
  }

  return pages.map((description, i) => ({
    embeds: [{
      title: pageTitle(title, i, pages.length),
      url: CHANGELOG_URL,
      description,
      color: 0xf4c430,
      // The count belongs on the last one, where it reads as a total rather
      // than as a claim about the message it is attached to.
      footer: { text: i === pages.length - 1 ? count : `${count} · continued below` },
    }],
  }))
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
export function buildChallengeEmbeds(
  date: string,
  changes: Change[],
  opts: { split?: boolean } = {},
): { embeds: unknown[] }[] {
  const challengeChanges = changes.filter((c) => c.level_rated === 'Challenge')
  if (!challengeChanges.length) return []

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

  const title = `Challenge Ranks — Recent Changes for ${date}`
  const count = `${challengeChanges.length} challenge change${challengeChanges.length === 1 ? '' : 's'}`
  const pages = paginateLines(lines)

  if (!opts.split && pages.length > 1) {
    return [{
      embeds: [{
        title,
        url: CHANGELOG_URL,
        description: `${pages[0]}\n…(truncated — turn on "Split long changelogs" to get the rest)`,
        color: 0xf59e0b,
        footer: { text: count },
      }],
    }]
  }

  return pages.map((description, i) => ({
    embeds: [{
      title: pageTitle(title, i, pages.length),
      url: CHANGELOG_URL,
      description,
      color: 0xf59e0b,
      footer: { text: i === pages.length - 1 ? count : `${count} · continued below` },
    }],
  }))
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

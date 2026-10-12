import type { Change } from '~/server/utils/changes'

export type WebhookKind = 'changes' | 'leaderboard' | 'level_status' | 'challenge_changes'

// Discord only turns a link into a link when it has a scheme.
const _rawUrl = (process.env.SITE_URL ?? '').replace(/\/+$/, '')
const SITE_URL = _rawUrl ? (/^https?:\/\//.test(_rawUrl) ? _rawUrl : `https://${_rawUrl}`) : ''
const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/

const ACCENT = 0x06b6d4
const CHALLENGE = 0xf59e0b

export function isValidDiscordWebhook(url: string): boolean {
  return DISCORD_WEBHOOK_PATTERN.test(url.trim())
}

/**
 * Level and player names are user text. Pings are blocked by
 * `allowed_mentions`; this stops a name turning into bold, a spoiler, a broken
 * link or a `<@id>` tag.
 */
export function escapeMarkdown(s: string): string {
  return s.replace(/([\\*_~`|[\]<>])/g, '\\$1')
}

/**
 * A link to a level that keeps working after the list changes: `/<gd id>`
 * resolves to wherever the level is now. Levels without an ID fall back to
 * their current position.
 */
function levelUrl(c: { level_gd_id: number | null; level_position: number | null }): string | null {
  if (!SITE_URL) return null
  if (c.level_gd_id) return `${SITE_URL}/${c.level_gd_id}`
  if (c.level_position) return `${SITE_URL}/levels/${c.level_position}`
  return null
}

function levelRef(c: Change): string {
  const name = escapeMarkdown(c.level_name)
  const url = c.kind === 'remove' ? null : levelUrl(c)
  return url ? `[${name}](${url})` : `**${name}**`
}

function tierEmoji(tier: string | null): string {
  if (!tier) return ''
  if (/^Subtier \d/.test(tier)) return ':tierunrated:'
  const t = tier.match(/^Tier (\d{1,2})$/)
  return t ? `:tier${t[1]!.padStart(2, '0')}:` : ''
}

/** Discord's embed description limit, less room for a "(continued)" heading. */
const DESCRIPTION_LIMIT = 3900

/**
 * Split lines into embed-sized pages on line boundaries. A section heading
 * (`**Moved up**`) is repeated at the top of a page that continues it.
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
    if (line.startsWith('**') && line.endsWith('**')) heading = line
    if (length + line.length + 1 > limit && current.length) {
      flush()
      if (heading && heading !== line) {
        const cont = `${heading.slice(0, -2)} (continued)**`
        current.push(cont)
        length += cont.length + 1
      }
    }
    current.push(line)
    length += line.length + 1
  }
  flush()
  return pages
}

type DigestOptions = {
  /** Show `:tierNN:` emoji next to each level (the server needs those emoji). */
  tierEmoji?: boolean
  /** Send every page instead of the first one with a note. */
  split?: boolean
}

type Payload = { embeds: unknown[]; allowed_mentions: { parse: never[] } }

/** `#N` on the main list, `Ch. #N` on the challenge digest. */
type Numbering = {
  to: (c: Change) => string
  from: (c: Change) => string
}

const MAIN_NUMBERS: Numbering = {
  to: (c) => `#${c.to_position}`,
  from: (c) => `#${c.from_position ?? c.to_position}`,
}

const CHALLENGE_NUMBERS: Numbering = {
  to: (c) => (c.challenge_rank != null ? `Ch. #${c.challenge_rank}` : `#${c.to_position}`),
  from: (c) => (c.from_challenge_rank != null ? `Ch. #${c.from_challenge_rank}` : `#${c.from_position ?? c.to_position}`),
}

function digestLines(changes: Change[], n: Numbering, opts: DigestOptions): string[] {
  const added = changes.filter((c) => c.kind === 'add')
  const up = changes.filter((c) => c.kind === 'move' && c.from_position != null && c.to_position < c.from_position)
  const down = changes.filter((c) => c.kind === 'move' && c.from_position != null && c.to_position > c.from_position)
  const removed = changes.filter((c) => c.kind === 'remove')
  const emoji = (c: Change) => {
    const e = opts.tierEmoji ? tierEmoji(c.level_gddl_tier) : ''
    return e ? ` ${e}` : ''
  }

  const lines: string[] = []
  const section = (title: string, rows: Change[], line: (c: Change) => string) => {
    if (!rows.length) return
    if (lines.length) lines.push('')
    lines.push(`**${title}**`)
    for (const c of [...rows].sort((a, b) => a.to_position - b.to_position)) lines.push(line(c))
  }
  section('Added', added, (c) => `\`${n.to(c)}\` ${levelRef(c)}${emoji(c)}${c.level_gddl_tier && !opts.tierEmoji ? ` · ${c.level_gddl_tier}` : ''}`)
  section('Moved up', up, (c) => `\`${n.to(c)}\` ${levelRef(c)}${emoji(c)} ↑ from ${n.from(c)}`)
  section('Moved down', down, (c) => `\`${n.to(c)}\` ${levelRef(c)}${emoji(c)} ↓ from ${n.from(c)}`)
  section('Removed', removed, (c) => `~~${escapeMarkdown(c.level_name)}~~ (was ${n.from(c)})`)
  return lines
}

function digestPayloads(title: string, changes: Change[], n: Numbering, color: number, opts: DigestOptions): Payload[] {
  if (!changes.length) return []
  const pages = paginateLines(digestLines(changes, n, opts))
  if (!pages.length) return []
  const count = `${changes.length} change${changes.length === 1 ? '' : 's'}`
  const url = SITE_URL ? `${SITE_URL}/changelog` : undefined
  const shown = opts.split ? pages : pages.slice(0, 1)
  return shown.map((description, i) => {
    const last = i === shown.length - 1
    const more = !opts.split && pages.length > 1 && last
    return {
      embeds: [{
        title: shown.length > 1 ? `${title} (${i + 1}/${shown.length})` : title,
        url,
        description: more ? `${description}\n\n…and more on the changelog.` : description,
        color,
        footer: { text: last ? count : `${count} · continued` },
      }],
      allowed_mentions: { parse: [] },
    }
  })
}

/** "October 11, 2026" for a UTC day. */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function buildDailyEmbeds(title: string, changes: Change[], opts: DigestOptions = {}): Payload[] {
  return digestPayloads(title, changes, MAIN_NUMBERS, ACCENT, opts)
}

export function buildChallengeEmbeds(title: string, changes: Change[], opts: DigestOptions = {}): Payload[] {
  return digestPayloads(title, changes.filter((c) => c.level_rated === 'Challenge'), CHALLENGE_NUMBERS, CHALLENGE, opts)
}

/** A record approval, for `leaderboard` webhooks. */
export function buildLeaderboardEmbed(opts: {
  playerName: string
  levelName: string
  levelPosition: number | null
  levelGdId: number | null
  levelPoints: number | null
  playerTotal: number | null
  videoUrl: string | null
  isVerification?: boolean
}): Payload {
  const url = levelUrl({ level_gd_id: opts.levelGdId, level_position: opts.levelPosition })
  const playerUrl = SITE_URL ? `${SITE_URL}/users/by-player/${encodeURIComponent(opts.playerName)}` : null
  const player = playerUrl ? `[${escapeMarkdown(opts.playerName)}](${playerUrl})` : `**${escapeMarkdown(opts.playerName)}**`
  const level = url ? `[${escapeMarkdown(opts.levelName)}](${url})` : `**${escapeMarkdown(opts.levelName)}**`
  const verb = opts.isVerification ? 'verified' : 'beat'

  const lines = [`${player} ${verb} ${level}${opts.levelPosition ? ` (#${opts.levelPosition})` : ''}`]
  if (opts.levelPoints != null) lines.push(`+${opts.levelPoints.toLocaleString('en-US')} points`)
  if (opts.playerTotal != null) lines.push(`${opts.playerTotal.toLocaleString('en-US')} points total`)
  if (!opts.isVerification && opts.videoUrl) lines.push(`[Video](${opts.videoUrl})`)

  return {
    embeds: [{
      title: `${opts.playerName} ${verb} ${opts.levelName}`.slice(0, 256),
      url: url ?? undefined,
      description: lines.join('\n'),
      color: 0x22c55e,
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: [] },
  }
}

/** A level sent to Awaiting Placement or the void list, for `level_status` webhooks. */
export function buildLevelStatusEmbed(opts: {
  destination: 'awaiting' | 'void'
  levelName: string
  gddlTier: string | null
  difficulty: string | null
  submitter: string | null
  verificationUrl: string | null
  awaitingId?: number | null
  voidPosition?: number | null
}): Payload {
  const awaiting = opts.destination === 'awaiting'
  let url: string | undefined
  if (SITE_URL) {
    if (awaiting) url = opts.awaitingId ? `${SITE_URL}/awaiting/${opts.awaitingId}` : `${SITE_URL}/awaiting`
    else if (opts.voidPosition) url = `${SITE_URL}/void/${opts.voidPosition}`
  }
  const lines: string[] = []
  if (opts.submitter) {
    const who = SITE_URL
      ? `[${escapeMarkdown(opts.submitter)}](${SITE_URL}/users/${encodeURIComponent(opts.submitter)})`
      : `**${escapeMarkdown(opts.submitter)}**`
    lines.push(`Submitted by ${who}`)
  }
  const meta = [opts.gddlTier, opts.difficulty].filter(Boolean)
  if (meta.length) lines.push(meta.join(' · '))
  if (opts.verificationUrl) lines.push(`[Verification](${opts.verificationUrl})`)

  return {
    embeds: [{
      title: `${opts.levelName} → ${awaiting ? 'Awaiting placement' : 'Void list'}`.slice(0, 256),
      url,
      description: lines.join('\n') || undefined,
      color: awaiting ? 0x38bdf8 : 0xa855f7,
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: [] },
  }
}

export type PostStatus = { ok: boolean; status: string; retryable: boolean }

/** POST a payload. Never throws. */
export async function postToDiscordWebhook(url: string, payload: object, timeoutMs = 10_000): Promise<PostStatus> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (resp.status === 204 || resp.status === 200) return { ok: true, status: 'ok', retryable: false }
    const body = await resp.text().catch(() => '')
    return {
      ok: false,
      status: `HTTP ${resp.status}${body ? ` ${body.slice(0, 160)}` : ''}`,
      // Rate limits and Discord's own outages pass; a 4xx about the webhook doesn't.
      retryable: resp.status === 429 || resp.status >= 500,
    }
  } catch (e: any) {
    return { ok: false, status: `error: ${e?.message ?? 'unknown'}`, retryable: true }
  }
}

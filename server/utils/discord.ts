import type { Change } from '~/server/utils/changes'

export type WebhookKind = 'changes' | 'leaderboard' | 'level_status' | 'challenge_changes'

// Discord only turns a link into a link when it has a scheme.
const _rawUrl = (process.env.SITE_URL ?? '').replace(/\/+$/, '')
export const SITE_URL = _rawUrl ? (/^https?:\/\//.test(_rawUrl) ? _rawUrl : `https://${_rawUrl}`) : ''
const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/

const SITE_NAME = 'All Levels List'

/** Embed colours, one per kind of news. */
export const COLORS = {
  accent: 0x22d3ee,
  challenge: 0xf59e0b,
  up: 0x34d399,
  down: 0xf87171,
  added: 0x38bdf8,
  removed: 0x71717a,
  record: 0x22c55e,
  verification: 0xfacc15,
  awaiting: 0x38bdf8,
  void: 0xa855f7,
} as const

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

const fmt = (n: number) => n.toLocaleString('en-US')

// ---------------------------------------------------------------- branding

/** The site's name and icon, at the top of a post. */
export function siteAuthor(name: string = SITE_NAME, url?: string | null) {
  return {
    name: name.slice(0, 256),
    url: (url ?? SITE_URL) || undefined,
    icon_url: SITE_URL ? `${SITE_URL}/icon-180.png` : undefined,
  }
}

/** The site's name and icon, at the foot of a post. */
export function siteFooter(text: string = SITE_NAME) {
  return {
    text: text.slice(0, 2048),
    icon_url: SITE_URL ? `${SITE_URL}/icon-180.png` : undefined,
  }
}

/** The level's community thumbnail, for an embed's corner. */
export function levelThumbnail(gdId: number | null | undefined) {
  return gdId && Number.isFinite(Number(gdId))
    ? { url: `https://levelthumbs.prevter.me/thumbnail/${gdId}/small` }
    : undefined
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

// ---------------------------------------------------------------- the daily digest

/** Discord's limits: 4096 per description, 6000 per message, 10 embeds. */
const DESCRIPTION_LIMIT = 3900
const MESSAGE_LIMIT = 5800
const MAX_EMBEDS = 10
/** Lines per section when not sending everything. */
const PREVIEW_LINES = 12

/**
 * Split lines into embed-sized pages on line boundaries.
 */
export function paginateLines(lines: string[], limit = DESCRIPTION_LIMIT): string[] {
  const pages: string[] = []
  let current: string[] = []
  let length = 0
  for (const line of lines) {
    if (length + line.length + 1 > limit && current.length) {
      pages.push(current.join('\n'))
      current = []
      length = 0
    }
    current.push(line)
    length += line.length + 1
  }
  if (current.length) pages.push(current.join('\n'))
  return pages
}

type DigestOptions = {
  /** Show `:tierNN:` emoji next to each level (the server needs those emoji). */
  tierEmoji?: boolean
  /** Send every change across as many messages as it takes, instead of a preview. */
  split?: boolean
  /** The end of the period, for the post's timestamp. */
  through?: string
}

type Embed = Record<string, unknown>
type Payload = { embeds: Embed[]; allowed_mentions: { parse: never[] } }

/** `#N` on the main list, `Challenge #N` on the challenge digest. */
type Numbering = {
  label: string
  to: (c: Change) => number | null
  from: (c: Change) => number | null
}

const MAIN_NUMBERS: Numbering = {
  label: '#',
  to: (c) => c.to_position,
  from: (c) => c.from_position,
}

const CHALLENGE_NUMBERS: Numbering = {
  label: 'Ch. #',
  to: (c) => c.challenge_rank ?? c.to_position,
  from: (c) => c.from_challenge_rank ?? c.from_position,
}

type Section = { key: 'up' | 'down' | 'added' | 'removed'; title: string; color: number; lines: string[] }

function sections(changes: Change[], n: Numbering, opts: DigestOptions): Section[] {
  const num = (v: number | null) => (v != null ? `${n.label}${fmt(v)}` : '?')
  const emoji = (c: Change) => {
    const e = opts.tierEmoji ? tierEmoji(c.level_gddl_tier) : ''
    return e ? ` ${e}` : ''
  }
  const byRank = (a: Change, b: Change) => (n.to(a) ?? 0) - (n.to(b) ?? 0)
  const diff = (c: Change) => Math.abs((n.from(c) ?? 0) - (n.to(c) ?? 0))

  const up = changes.filter((c) => c.kind === 'move' && (n.from(c) ?? 0) > (n.to(c) ?? 0)).sort(byRank)
  const down = changes.filter((c) => c.kind === 'move' && (n.from(c) ?? 0) < (n.to(c) ?? 0)).sort(byRank)
  const added = changes.filter((c) => c.kind === 'add').sort(byRank)
  const removed = changes.filter((c) => c.kind === 'remove').sort((a, b) => (n.from(a) ?? n.to(a) ?? 0) - (n.from(b) ?? n.to(b) ?? 0))

  const out: Section[] = []
  if (up.length) out.push({
    key: 'up', title: `▲ Moved up · ${fmt(up.length)}`, color: COLORS.up,
    lines: up.map((c) => `\`${num(n.to(c))}\` ${levelRef(c)}${emoji(c)} · up ${fmt(diff(c))} from ${num(n.from(c))}`),
  })
  if (down.length) out.push({
    key: 'down', title: `▼ Moved down · ${fmt(down.length)}`, color: COLORS.down,
    lines: down.map((c) => `\`${num(n.to(c))}\` ${levelRef(c)}${emoji(c)} · down ${fmt(diff(c))} from ${num(n.from(c))}`),
  })
  if (added.length) out.push({
    key: 'added', title: `＋ Added · ${fmt(added.length)}`, color: COLORS.added,
    lines: added.map((c) => `\`${num(n.to(c))}\` ${levelRef(c)}${emoji(c)}${!opts.tierEmoji && c.level_gddl_tier ? ` · ${c.level_gddl_tier}` : ''}`),
  })
  if (removed.length) out.push({
    key: 'removed', title: `✕ Removed · ${fmt(removed.length)}`, color: COLORS.removed,
    lines: removed.map((c) => `~~${escapeMarkdown(c.level_name)}~~ · was ${num(n.from(c) ?? n.to(c))}`),
  })
  return out
}

function embedLength(e: Embed): number {
  const s = (v: unknown) => (typeof v === 'string' ? v.length : 0)
  const author = e.author as { name?: string } | undefined
  const footer = e.footer as { text?: string } | undefined
  return s(e.title) + s(e.description) + s(author?.name) + s(footer?.text)
}

/**
 * The level to show in the header's corner: the highest one added, or else
 * the highest one that moved.
 */
function headlineLevel(changes: Change[], n: Numbering): Change | undefined {
  const pick = (kind: Change['kind']) => changes
    .filter((c) => c.kind === kind && c.level_gd_id)
    .sort((a, b) => (n.to(a) ?? 0) - (n.to(b) ?? 0))[0]
  return pick('add') ?? pick('move')
}

function digestPayloads(title: string, changes: Change[], n: Numbering, color: number, opts: DigestOptions): Payload[] {
  if (!changes.length) return []
  const secs = sections(changes, n, opts)
  if (!secs.length) return []
  const changelogUrl = SITE_URL ? `${SITE_URL}/changelog` : undefined
  const timestamp = opts.through ? new Date(`${opts.through.replace(' ', 'T')}Z`).toISOString() : new Date().toISOString()
  const count = `${fmt(changes.length)} change${changes.length === 1 ? '' : 's'}`

  const summary = secs.map((s) => s.title.replace(' · ', ' ')).join('   ')
  const headline = headlineLevel(changes, n)
  const header: Embed = {
    author: siteAuthor(),
    title: title.slice(0, 256),
    url: changelogUrl,
    description: summary,
    color,
    thumbnail: levelThumbnail(headline?.level_gd_id ?? null),
  }

  // One embed per section page. In preview mode each section is cut to its
  // first lines with a pointer to the rest.
  const bodies: Embed[] = []
  for (const s of secs) {
    let lines = s.lines
    if (!opts.split && lines.length > PREVIEW_LINES) {
      const rest = lines.length - PREVIEW_LINES
      lines = [...lines.slice(0, PREVIEW_LINES), changelogUrl ? `[…and ${fmt(rest)} more on the changelog](${changelogUrl})` : `…and ${fmt(rest)} more`]
    }
    const pages = paginateLines(lines)
    pages.forEach((description, i) => {
      bodies.push({
        title: i === 0 ? s.title : `${s.title} (continued)`,
        description,
        color: s.color,
      })
    })
  }

  // Pack into messages within Discord's limits; the header leads the first.
  const messages: Embed[][] = [[header]]
  let used = embedLength(header)
  for (const b of bodies) {
    const len = embedLength(b)
    const cur = messages[messages.length - 1]!
    if (cur.length >= MAX_EMBEDS || used + len > MESSAGE_LIMIT) {
      messages.push([b])
      used = len
    } else {
      cur.push(b)
      used += len
    }
  }

  // In preview mode only the first message goes out; anything that didn't fit
  // in it is summed up in its last embed.
  let out = messages
  if (!opts.split && messages.length > 1) {
    out = [messages[0]!]
    const left = messages.slice(1).flat().length
    const last = out[0]![out[0]!.length - 1]!
    last.description = `${String(last.description ?? '')}\n\n${changelogUrl ? `[More on the changelog](${changelogUrl})` : 'More on the changelog'} (${left} more section${left === 1 ? '' : 's'})`.slice(0, 4096)
  }

  return out.map((embeds, i) => {
    const last = embeds[embeds.length - 1]!
    last.footer = siteFooter(out.length > 1 ? `${count} · part ${i + 1} of ${out.length}` : count)
    last.timestamp = timestamp
    return { embeds, allowed_mentions: { parse: [] } }
  })
}

/** "October 11, 2026" for a UTC day. */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function buildDailyEmbeds(title: string, changes: Change[], opts: DigestOptions = {}): Payload[] {
  return digestPayloads(title, changes, MAIN_NUMBERS, COLORS.accent, opts)
}

export function buildChallengeEmbeds(title: string, changes: Change[], opts: DigestOptions = {}): Payload[] {
  return digestPayloads(title, changes.filter((c) => c.level_rated === 'Challenge'), CHALLENGE_NUMBERS, COLORS.challenge, opts)
}

// ---------------------------------------------------------------- single events

/** A record approval, for `leaderboard` webhooks. */
export function buildLeaderboardEmbed(opts: {
  playerName: string
  /** The player's account here, for the link and picture. */
  playerUsername?: string | null
  playerAvatarUrl?: string | null
  levelName: string
  levelPosition: number | null
  levelGdId: number | null
  levelTier?: string | null
  levelPoints: number | null
  playerTotal: number | null
  percent?: number | null
  videoUrl: string | null
  isVerification?: boolean
}): Payload {
  const url = levelUrl({ level_gd_id: opts.levelGdId, level_position: opts.levelPosition })
  const playerUrl = SITE_URL
    ? (opts.playerUsername
      ? `${SITE_URL}/users/${encodeURIComponent(opts.playerUsername)}`
      : `${SITE_URL}/users/by-player/${encodeURIComponent(opts.playerName)}`)
    : null
  const progress = opts.percent != null && opts.percent < 100
  // The player heads the post, so the title is what they did.
  const action = opts.isVerification ? 'Verified' : progress ? `${opts.percent}% on` : 'Beat'

  const fields: { name: string; value: string; inline: boolean }[] = []
  if (opts.levelPosition) fields.push({ name: 'Placement', value: `#${fmt(opts.levelPosition)}`, inline: true })
  if (opts.levelTier) fields.push({ name: 'Tier', value: opts.levelTier, inline: true })
  if (opts.levelPoints != null && !progress) fields.push({ name: 'Points', value: `+${fmt(opts.levelPoints)}`, inline: true })
  if (opts.playerTotal != null) fields.push({ name: 'Total points', value: fmt(opts.playerTotal), inline: true })

  return {
    embeds: [{
      author: {
        name: opts.playerName.slice(0, 256),
        url: playerUrl ?? undefined,
        icon_url: opts.playerAvatarUrl ?? (SITE_URL ? `${SITE_URL}/icon-180.png` : undefined),
      },
      title: `${action} ${opts.levelName}`.slice(0, 256),
      url: url ?? undefined,
      description: opts.videoUrl ? `[Watch the ${opts.isVerification ? 'verification' : 'run'}](${opts.videoUrl})` : undefined,
      fields,
      thumbnail: levelThumbnail(opts.levelGdId),
      color: opts.isVerification ? COLORS.verification : COLORS.record,
      footer: siteFooter('All Levels List · records'),
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: [] },
  }
}

/** A level sent to Awaiting Placement or the void list, for `level_status` webhooks. */
export function buildLevelStatusEmbed(opts: {
  destination: 'awaiting' | 'void'
  levelName: string
  gdId?: number | null
  gddlTier: string | null
  difficulty: string | null
  submitter: string | null
  verificationUrl: string | null
  awaitingId?: number | null
  voidPosition?: number | null
}): Payload {
  const awaiting = opts.destination === 'awaiting'
  let url: string | undefined
  let listUrl: string | undefined
  if (SITE_URL) {
    listUrl = awaiting ? `${SITE_URL}/awaiting` : `${SITE_URL}/void`
    if (awaiting) url = opts.awaitingId ? `${SITE_URL}/awaiting/${opts.awaitingId}` : listUrl
    else url = opts.voidPosition ? `${SITE_URL}/void/${opts.voidPosition}` : listUrl
  }
  const lines: string[] = [awaiting
    ? 'Approved, and waiting for a place on the list.'
    : 'On the void list until someone gives it a difficulty opinion.']
  if (opts.verificationUrl) lines.push(`[Verification](${opts.verificationUrl})`)

  const fields: { name: string; value: string; inline: boolean }[] = []
  if (opts.gddlTier) fields.push({ name: 'Tier', value: opts.gddlTier, inline: true })
  if (opts.difficulty) fields.push({ name: 'Difficulty', value: opts.difficulty, inline: true })
  if (opts.voidPosition && !awaiting) fields.push({ name: 'Void list', value: `#${fmt(opts.voidPosition)}`, inline: true })
  if (opts.submitter) {
    fields.push({
      name: 'Submitted by',
      value: SITE_URL
        ? `[${escapeMarkdown(opts.submitter)}](${SITE_URL}/users/${encodeURIComponent(opts.submitter)})`
        : escapeMarkdown(opts.submitter),
      inline: true,
    })
  }

  return {
    embeds: [{
      author: siteAuthor(awaiting ? 'Awaiting placement' : 'Void list', listUrl),
      title: opts.levelName.slice(0, 256),
      url,
      description: lines.join('\n'),
      fields,
      thumbnail: levelThumbnail(opts.gdId),
      color: awaiting ? COLORS.awaiting : COLORS.void,
      footer: siteFooter(),
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: [] },
  }
}

/** What a webhook will receive, for the "Send a test" button. */
export function buildTestEmbed(kind: string): Payload {
  const what: Record<string, string> = {
    changes: 'A summary of every level added, moved or removed, once a day.',
    challenge_changes: 'A summary of the challenge list changes, once a day.',
    leaderboard: 'A post for every approved record.',
    level_status: 'A post when a level is sent to Awaiting Placement or the void list.',
  }
  return {
    embeds: [{
      author: siteAuthor(),
      title: 'This webhook works',
      url: SITE_URL || undefined,
      description: what[kind] ?? 'Posts from the All Levels List.',
      color: COLORS.accent,
      footer: siteFooter(),
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

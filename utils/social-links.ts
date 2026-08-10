/**
 * The places a profile can point at.
 *
 * Each one is a column on `accounts` and each is checked against the host it
 * claims to be — which is the reason these are separate fields rather than a
 * free list of links. A row of unlabelled URLs is a link tree; this is a
 * profile saying "I am this person on YouTube and that one on Twitch", and
 * the site can only render the right icon beside a link it can identify.
 *
 * `handle` is what the chip shows. A URL is unreadable at chip size and every
 * one of these services has a name inside it that isn't.
 */
export type SocialKey = 'youtube_url' | 'twitch_url' | 'twitter_url' | 'bluesky_url'

export type SocialDef = {
  key: SocialKey
  label: string
  /** Placeholder for the settings field. */
  example: string
  /** Hosts the URL is allowed to be on. */
  hosts: string[]
  /** Pulls the readable name out of a valid URL. */
  handle: (url: string) => string | null
  /** Tailwind text colour for the icon, on hover. */
  tone: string
}

const path1 = (url: string): string | null => {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)
    return seg[0] ?? null
  } catch { return null }
}

export const SOCIAL_LINKS: SocialDef[] = [
  {
    key: 'youtube_url',
    label: 'YouTube',
    example: 'https://www.youtube.com/@yourhandle',
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
    handle: (url) => {
      const m = url.match(/youtube\.com\/(@[^/?&#]+)/i)
      return m ? m[1]! : 'YouTube'
    },
    tone: 'hover:text-red-400 hover:border-red-900/60',
  },
  {
    key: 'twitch_url',
    label: 'Twitch',
    example: 'https://twitch.tv/yourname',
    hosts: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
    handle: (url) => path1(url),
    tone: 'hover:text-[#a970ff] hover:border-purple-900/60',
  },
  {
    key: 'twitter_url',
    label: 'X',
    example: 'https://x.com/yourname',
    hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
    handle: (url) => {
      const h = path1(url)
      return h ? `@${h}` : null
    },
    tone: 'hover:text-zinc-100 hover:border-zinc-600',
  },
  {
    key: 'bluesky_url',
    label: 'Bluesky',
    example: 'https://bsky.app/profile/you.bsky.social',
    hosts: ['bsky.app', 'www.bsky.app'],
    handle: (url) => {
      const m = url.match(/bsky\.app\/profile\/([^/?&#]+)/i)
      return m ? `@${m[1]}` : null
    },
    tone: 'hover:text-sky-400 hover:border-sky-900/60',
  },
]

export function socialDef(key: string): SocialDef | undefined {
  return SOCIAL_LINKS.find((s) => s.key === key)
}

/**
 * Is this a URL for that service?
 *
 * https only, and the host has to be one the definition names — checked as a
 * parsed host rather than with a substring match, because
 * `https://evil.example/youtube.com` contains "youtube.com" and is not it.
 */
export function isValidSocialUrl(key: string, url: string): boolean {
  const def = socialDef(key)
  if (!def) return false
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  return def.hosts.includes(parsed.hostname.toLowerCase())
}

/** What to print on the chip: the handle if there is one, else the service. */
export function socialHandle(key: string, url: string | null | undefined): string | null {
  const def = socialDef(key)
  if (!def || !url) return null
  return def.handle(url) ?? def.label
}

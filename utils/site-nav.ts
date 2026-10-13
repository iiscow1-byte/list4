import { ALL_SHEET_URL } from '~/utils/sheet'

/**
 * The site's navigation, as data, so the header and the phone drawer always
 * list the same pages. Labels are English and go through `t()` (utils/i18n.ts).
 */

export type NavLink = {
  label: string
  /** Internal route. Exactly one of `to` / `href`. */
  to?: string
  /** External URL. */
  href?: string
  /** Only for signed-in visitors. */
  authOnly?: boolean
  /** Lights a dot while there's a site update the visitor hasn't opened. */
  flag?: 'updates'
  /** A `NavIcon` name. */
  icon?: string
}

export type NavMenu = {
  key: string
  label: string
  /** Where the label itself goes. */
  to: string
  /** Route prefixes (whole segments) that count as being in this section. */
  match: string[]
  /** Pages under this one; shown as a dropdown. */
  links?: NavLink[]
  /** A `NavIcon` name, for the phone menu. */
  icon?: string
}

export const SITE_NAV: NavMenu[] = [
  {
    key: 'list',
    label: 'List',
    to: '/levels/1',
    match: ['/levels', '/awaiting', '/void', '/open-verifications'],
    links: [
      { label: 'Main list', to: '/levels/1', icon: 'list' },
      { label: 'Challenge list', to: '/levels/challenges', icon: 'trophy' },
      { label: 'Awaiting placement', to: '/awaiting', icon: 'hourglass' },
      { label: 'Void list', to: '/void', icon: 'void' },
      { label: 'Open verifications', to: '/open-verifications', icon: 'verify' },
      { label: 'The ALL sheet', href: ALL_SHEET_URL, icon: 'sheet' },
    ],
  },
  { key: 'changelog', label: 'Changelog', to: '/changelog', match: ['/changelog'], icon: 'changelog' },
  {
    key: 'leaderboard',
    label: 'Leaderboard',
    to: '/leaderboard',
    icon: 'leaderboard',
    match: ['/leaderboard', '/aredl-players', '/gdl-players', '/pointercrate-players'],
  },
  {
    key: 'community',
    label: 'Community',
    to: '/community',
    match: ['/community', '/clans', '/users'],
    links: [
      { label: 'Community hub', to: '/community', icon: 'users' },
      { label: 'Clans', to: '/clans', icon: 'clan' },
    ],
  },
  {
    key: 'lists',
    label: 'Lists',
    to: '/lists',
    match: ['/lists', '/builder'],
    links: [
      { label: 'Custom lists', to: '/lists', icon: 'layers' },
      { label: 'Build your own list', to: '/builder', icon: 'build' },
    ],
  },
  {
    key: 'about',
    label: 'About',
    to: '/about',
    match: ['/about', '/updates'],
    links: [
      { label: 'About & stats', to: '/about', icon: 'info' },
      { label: 'List updates', to: '/updates', flag: 'updates', icon: 'updates' },
    ],
  },
]

export const SUBMIT_NAV: NavLink[] = [
  { label: 'Submit a record', to: '/records/submit', icon: 'record' },
  { label: 'Submit a level', to: '/levels/submit', icon: 'level' },
  { label: 'Submit an opinion', to: '/opinions/submit', icon: 'opinion' },
  { label: 'Find a level', to: '/levels/find', icon: 'search' },
]

export const SUBMIT_MATCH = ['/records', '/opinions', '/levels/submit', '/levels/find']

export const SITE_SOCIALS = [
  { label: 'Discord', href: 'https://discord.gg/KfZvUpS3PB' },
  { label: 'YouTube', href: 'https://www.youtube.com/@AllLevelsList' },
  { label: 'X', href: 'https://x.com/alllevelslist' },
  { label: 'TikTok', href: 'https://tiktok.com/@alllevelslist' },
] as const

/** Whether `path` is inside one of `prefixes`, matching whole segments. */
export function pathMatches(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`))
}

export function navMatches(path: string, menu: NavMenu): boolean {
  // The submit pages live under /levels too, but they belong to Submit.
  if (menu.key === 'list' && pathMatches(path, SUBMIT_MATCH)) return false
  return pathMatches(path, menu.match)
}

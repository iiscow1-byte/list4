import { SITE_VERSION, versionLabel } from '~/utils/site-updates'
import { ALL_SHEET_URL } from '~/utils/sheet'

/**
 * The site's navigation, as data.
 *
 * There are two navigations now — the dropdown row on a wide screen and the
 * drawer on a narrow one — and they must never disagree about what the site
 * contains. Written twice they would: a page added to one is a page missing
 * from the other, and nothing would ever notice.
 *
 * So the tree lives here and both read it. What differs between them is
 * *presentation*: the header shows four dropdowns, the drawer shows the same
 * four as stacked sections. Neither knows anything the other doesn't.
 */

export type NavLink = {
  label: string
  /** An internal route. Exactly one of `to` / `href`. */
  to?: string
  /** An external URL. */
  href?: string
  hint: string
  /** A key from `components/NavIcon.vue`. */
  icon: string
  /** The one row in each menu worth leading with. */
  accent?: boolean
  /** Only shown to a signed-in visitor. */
  authOnly?: boolean
  /** Named runtime marker the header resolves — currently only unread updates. */
  flag?: 'updates'
}

export type NavGroup = { label: string; links: NavLink[] }

export type NavMenu = {
  key: string
  label: string
  /** When set, the label itself navigates and only the chevron opens the menu. */
  to?: string
  /**
   * Route prefixes that mean "you are in this part of the site".
   *
   * Prefixes rather than exact paths, matched as a whole segment: `/levels`
   * lights the List menu for `/levels/1` and for `/levels/submit`… which is why
   * Submit claims that one back explicitly below. Order matters only in that
   * every menu is asked, and more than one may answer — which is correct, since
   * `/levels/submit` genuinely belongs to both.
   */
  match: string[]
  groups: NavGroup[]
}

export const SITE_NAV: NavMenu[] = [
  {
    key: 'build',
    label: 'Build',
    to: '/builder',
    match: ['/builder', '/lists'],
    groups: [
      {
        label: 'Your lists',
        links: [
          // it makes a kind of list, not a separate feature, and a second entry
          // beside this one implied otherwise. "My lists" is gone for the same
          // reason — the gallery it pointed at has its own Mine tab.
          { label: 'Build your own list', to: '/builder', hint: 'Drag levels in and rank them yourself', icon: 'build', accent: true },
        ],
      },
      {
        label: 'Discover',
        links: [
          { label: 'Custom lists', to: '/lists', hint: 'Lists shared by the community, and your own', icon: 'gallery' },
        ],
      },
    ],
  },
  {
    key: 'list',
    label: 'List',
    to: '/levels/1',
    match: ['/levels', '/awaiting', '/void', '/open-verifications'],
    groups: [
      {
        label: 'Ranked',
        links: [
          { label: 'Main list', to: '/levels/1', hint: 'Every ranked level', icon: 'list' },
        ],
      },
      {
        label: 'In progress',
        links: [
          { label: 'Awaiting placement', to: '/awaiting', hint: 'Approved, not yet placed', icon: 'clock' },
          { label: 'Void list', to: '/void', hint: 'No difficulty opinion yet', icon: 'void' },
          { label: 'Open verifications', to: '/open-verifications', hint: 'Unverified levels looking for a verifier', icon: 'verify' },
        ],
      },
      {
        label: 'Source',
        links: [
          { label: 'The ALL sheet', href: ALL_SHEET_URL, hint: 'The Google Sheet this list is built from', icon: 'sheet' },
        ],
      },
    ],
  },
  {
    key: 'community',
    label: 'Community',
    to: '/community',
    match: ['/community', '/leaderboard', '/clans', '/changelog', '/users', '/about', '/updates'],
    groups: [
      {
        label: 'People',
        links: [
          /**
           * The hub covers the feed *and* the forum.
           *
           * The forum had a menu entry of its own for about a day. It was
           * wrong: a menu is a list of places the site has, and "somewhere to
           * read what people are doing" and "somewhere to talk about it" are
           * not two places — they are the same room, and splitting them meant
           * neither half was ever busy. It is a section of the hub now, and
           * this is the one door.
           *
           * Friends went the same way, for a different reason: your friends
           * are part of *your profile*, not a page of the site. See the account
           * page and the social menu in `components/SiteHeader.vue`.
           */
          { label: 'Community hub', to: '/community', hint: 'What the list and its players are up to', icon: 'users' },
          { label: 'Leaderboard', to: '/leaderboard', hint: 'Ranked players', icon: 'trophy' },
          { label: 'Clans', to: '/clans', hint: 'Groups of players, ranked together', icon: 'users' },
        ],
      },
      {
        label: 'The list',
        links: [
          { label: 'Changelog', to: '/changelog', hint: 'Placements and movements', icon: 'history' },
          { label: 'List updates', to: '/updates', hint: `What's new on the site — ${versionLabel(SITE_VERSION)}`, icon: 'sparkles', flag: 'updates' },
          { label: 'About & stats', to: '/about', hint: 'How the list works, and stats', icon: 'info' },
        ],
      },
    ],
  },
  {
    key: 'submit',
    label: 'Submit',
    match: ['/records', '/opinions', '/levels/submit'],
    groups: [
      {
        label: 'Levels',
        links: [
          { label: 'Find a level', to: '/levels/find', hint: 'Search Geometry Dash and submit from results', icon: 'search', accent: true },
          { label: 'Submit a level', to: '/levels/submit', hint: 'Add a level to the list', icon: 'plus' },
        ],
      },
      {
        label: 'Your play',
        links: [
          { label: 'Submit a record', to: '/records/submit', hint: 'Claim a completion', icon: 'medal' },
          { label: 'Submit an opinion', to: '/opinions/submit', hint: 'Rate difficulty and enjoyment', icon: 'star' },
        ],
      },
    ],
  },
]

/**
 * Whether a menu covers the page you are on.
 *
 * Whole segments, so `/levelsomething` never lights up `/levels` — the old
 * hand-written `startsWith` checks compared `route.path.startsWith('/levels/')`
 * *or* an exact match, which is this, written out four times.
 */
export function navMatches(path: string, menu: NavMenu): boolean {
  return menu.match.some((p) => path === p || path.startsWith(`${p}/`))
}

/**
 * The site's own changelog — what shipped to the website, as opposed to
 * `/changelog`, which is what moved on the list.
 *
 * Newest first. Every entry bumps the patch number, so `SITE_VERSION` is
 * simply the newest entry's version; a release that changes how the site works
 * end-to-end takes the minor. Add an entry here whenever you ship, and the
 * version chip, the Updates page and the "new since your last visit" dot all
 * follow from it — there is nothing else to remember to update.
 */
export type SiteUpdate = {
  /** Semantic-ish: major.minor.patch, monotonically increasing down the file. */
  version: string
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  title: string
  /** One line per change. Written for readers of the site, not the diff. */
  changes: string[]
  /** Optional grouping chips shown next to the entry. */
  tags?: string[]
}

export const SITE_UPDATES: SiteUpdate[] = [
  {
    version: '1.1.0',
    date: '2026-07-31',
    title: 'Profiles, custom lists and a version number',
    tags: ['Profiles', 'Custom lists', 'UI', 'Performance'],
    changes: [
      'Profiles rebuilt around a cover image: pick a hardest completion or a favourite level and its art paints your header.',
      'New "Hardest completion" pick — choose any of your approved records and it headlines your profile with percent, points and proof.',
      'Community hub reworked into a proper feed with avatars, level art, activity chips and per-kind filters.',
      'Custom lists gained an in-list editor: drag rows to reorder, type a rank to move a level, or edit and remove one without leaving the list.',
      'Custom-list level rows now match the main list exactly, so the two read as one site.',
      'Custom-list leaderboard redesigned — podium for the top three, points bars, avatars, player search and per-player breakdowns.',
      'Player leaderboard gained a podium, avatars and points bars, and now pages instantly instead of rebuilding the whole ranking per page.',
      'Admin "create a custom list" can now pull from any imported list (CCL, TSL, AREDL, GDL, MSCL and the rest), not just the ALL — shared levels stay linked to the ALL list.',
      'Moving a level got quicker: ±1/±5/±10 nudges, a drag-to-place button and a "move now" that skips the rest of the edit form.',
      'Changelog regrouped by day with movement distances, per-day tallies, level art, a name filter and a compact density toggle.',
      'Every header dropdown redesigned with icons, sections, current-page highlighting and arrow-key navigation.',
      'Faster all round: fewer font files, cached community data, pre-compressed assets, and new indexes behind the feed and leaderboard.',
      'This page: a running log of website updates, with a version number in the footer.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-24',
    title: 'All Levels List, on the web',
    tags: ['Launch'],
    changes: [
      'The full ALL list with level art, tier colours, filters and search.',
      'Awaiting placement, Void list and Open verifications as first-class lists.',
      'Build-your-own custom lists: leaderboards, records, packs, editors, webhooks and a changelog each.',
      'Records, level submissions, difficulty opinions and movement requests, with an admin review queue behind them.',
      'Player leaderboard merging ALL, AREDL, Pointercrate and GDL, plus imported placement history.',
    ],
  },
]

/** The version the site is currently running — shown in the footer. */
export const SITE_VERSION: string = SITE_UPDATES[0]?.version ?? '1.0.0'

/** The date of the newest entry, used for the "new updates" dot. */
export const SITE_VERSION_DATE: string = SITE_UPDATES[0]?.date ?? ''

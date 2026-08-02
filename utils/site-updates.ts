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
    version: '1.6.0',
    date: '2026-08-02',
    title: 'Imports you can watch, and levels that can go back to the sheet',
    tags: ['Admin', 'Imports', 'UI', 'Fixes'],
    changes: [
      'Imports show a progress bar with the phase and the count, instead of a "Running" chip that meant the same thing at ten seconds and at ten minutes.',
      'Admin: hand a level stored on this site back to the sheet. It takes the sheet\'s data, drops the site\'s ownership, and the importer owns the row from then on — which is what the sheet-exclusive report has been asking for after every import.',
      'Imported moves now suggest the smallest move that satisfies the imported list, and name the two levels it puts each one between. A level rearranged over there lands next to its new neighbours here rather than in the middle of levels that list has no opinion about.',
      'Every list this site imports is on About → Lists used automatically, with how many levels it carries and how many the ALL shares. Adding an importer adds it to the page.',
      '"Site-only levels" on the main list is a moderator filter now — it answers a question about the sheet\'s bookkeeping, not about the list.',
      'The List menu has a link straight to the ALL sheet.',
      'Pending levels: a dot on each queue row says whether it has everything it needs, the detail panel names what\'s missing instead of showing six empty tiles, deciding moves to the next submission instead of back to the top, and j/k walk the queue.',
      'Submit a level shows the level\'s art once you type an ID, and the checklist chips jump to the field they name — including into collapsed sections.',
      'Submit a record shows the level you picked, with its art and placement, so the wrong variant is visible before you send it.',
      'The builder\'s intro collapses, and stays collapsed.',
    ],
  },
  {
    version: '1.5.1',
    date: '2026-08-02',
    title: 'Sharper backgrounds, and a filter that runs before the words land',
    tags: ['UI', 'Custom lists', 'Moderation', 'Fixes'],
    changes: [
      'Level backgrounds now come in the size the screen actually needs. Big headers are sharper on desktop, and phones stop downloading a megabyte to paint one they can\'t show.',
      'Profanity is refused where it becomes part of the site rather than one person\'s message: usernames, custom list titles and descriptions, pack names, level notes, record player names, and comments.',
      'The filter reads through the usual dodges — sh1t, f.u.c.k, fuuuck — while leaving Scunthorpe, assassin, analysis, cockpit and Uranus alone.',
      'New custom list setting: records don\'t need a video link. Off by default, for lists whose community already trusts its members.',
      'Fixed: a custom list leaderboard with one or two players showed "No players match “”" and nothing else. With exactly three it said the same thing under a podium showing all three.',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-08-02',
    title: 'Placement backups, and the ALL stops borrowing AREDL\'s history',
    tags: ['Admin', 'Changelog', 'Community', 'Fixes'],
    changes: [
      'Admin: download every placement as a file and upload it back to undo. The CSV is editable — retype a few numbers in a spreadsheet and feed it in to move those levels.',
      'Admin: "Reset to the sheet\'s order" puts every sheet-backed level back where the sheet has it, without re-downloading the sheet. Site-only levels hold their positions.',
      'Both preview what they would do before anything moves, and save the current placements next to the database first.',
      'New admin tab, Imported moves: the levels an imported list and the ALL both carry but rank differently, with where that list says each belongs and one button to move it.',
      'The changelog is the ALL\'s own history again. 1,774 of its 1,777 entries were imported AREDL movements describing another site\'s list; they are gone, and the Newly ranked panel no longer shows placements from 2019.',
      'Level graphs keep AREDL\'s placement history and now plot the ALL\'s alongside it, each on its own scale — the two were sharing one axis, which made both unreadable.',
      'Community: search for a player across members, the ALL, AREDL, Pointercrate and GDL at once. Someone who has claimed their leaderboard name is found once, as themselves.',
      'Fixed: placement and tier estimates collapsed onto one answer. Levels below the lowest-ranked level on a list all reported that level\'s tier, and levels between two known ones all got the same midpoint. Both now follow the list\'s own spacing.',
      'Fixed: levels submitted from a custom list arrived with no verification date. It is read from the video, in one request for the whole batch.',
      'Fixed: levels submitted from a custom list arrived with no estimated placement, even though the list had already worked one out.',
      'Fixed: the bulk submit page told you every level was already on the ALL for a moment before showing the ones that weren\'t.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-08-01',
    title: 'Closed for alpha',
    tags: ['Access', 'Admin'],
    changes: [
      'The site is now restricted to the team while the list and the website settle.',
      'Account creation is closed. Existing accounts still sign in; nobody new can register.',
      'Signed-in accounts without access get a page explaining that, instead of being bounced around a login form they can already satisfy.',
      'Admin accounts are created from the command line while sign-ups are off, which is also the way back in if the last one is ever lost.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-01',
    title: 'About, profiles and the admin panel',
    tags: ['Profiles', 'Admin', 'UI', 'Fixes'],
    changes: [
      'About & stats rebuilt: three tabs, real charts instead of a grid of coloured boxes, and new numbers — records, players, record coverage, skillsets and the hardest level on the list.',
      'Your account page is now the profile you are editing: the same cover art, avatar and headline stats visitors see, updating live as you change them.',
      'New profile banner option — pick any level on the list as your header art, no record or favourite required.',
      'Fixed: words ran together in the community Following feed ("GERGcompletedSociety"). They are separate words again.',
      'Fixed: the account settings form forgot your banner and pinned completion every time it opened, and saving could clear them.',
      'Fixed: the admin Pending menu opened behind the page and could not be clicked.',
      'Public lists are called Custom lists, and the gallery has a My lists view that includes the ones you have not published.',
      'Admin: download a report of everywhere the ALL sheet and this site disagree — where the numbering drifts apart, which levels the sheet has never heard of, and which sheet rows never landed here.',
      '"Site only" now means what it says: the sheet has no level with that ID. Renamed levels and Solo/2P pairs are no longer mislabelled.',
      'Admin level queues got level art, tier colours and a readable layout; the submit forms show what is still missing before you press Submit.',
      'The footer credits everyone who built the site, and says plainly that the list is in alpha.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-01',
    title: 'Custom lists feed the ALL',
    tags: ['Custom lists', 'Submissions', 'Fixes'],
    changes: [
      'New "To the ALL" tab on custom lists: pick as many levels as you like and submit them all at once, with each row reporting exactly what it still needs.',
      'Submissions from a custom list now arrive with a tier and placement estimated from the neighbours that are already on the ALL — the ordering a curated list encodes is the estimate.',
      'New list setting: order a list by ALL placements and it keeps up as the ALL changes. Your hand-made order is kept and restored if you turn it back off.',
      'Fixed: avatars showed black corners on profiles. Older pictures had the corners baked in by the previous cropper; profile avatars are round again, which is how they render everywhere else.',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-08-01',
    title: 'Placements that actually move',
    tags: ['Fixes', 'Custom lists', 'Profiles'],
    changes: [
      'Fixed: moving a level left it printing its old placement, and shifted every level it displaced by one. Placement numbers now belong to the slot, not the level.',
      'Lists already damaged by that bug are repaired automatically on the next start — there is also a "Repair placements" button in the admin Imports tab.',
      'Custom-list rows now link themselves to the matching ALL level when it can be identified without guessing, so they follow the main list instead of going stale. Editors can link or unlink by hand when a level ID is shared by several variants.',
      'New "Submit to the ALL" button on custom-list levels that the main list doesn\'t have yet — it opens the submit form with everything already filled in.',
      'Rebuilt the profile-picture cropper: bigger stage, pinch and drag on touch, zoom that follows your cursor, live previews, and arrow-key nudging.',
      'Fixed: cropped avatars had black corners wherever they were shown as a square.',
      'Roomier typography in the community Following feed.',
    ],
  },
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

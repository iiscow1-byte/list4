/**
 * The site's own changelog — what shipped to the website, as opposed to
 * `/changelog`, which is what moved on the list.
 *
 * Newest first. Every entry bumps the patch number, so `SITE_VERSION` is
 * simply the newest entry's version; a release that changes how the site works
 * end-to-end takes the minor. Add an entry here whenever you ship, and the
 * version chip, the Updates page and the "new since your last visit" dot all
 * follow from it — there is nothing else to remember to update.
 *
 * ## Two audiences, one file
 *
 * Roughly a third of what has ever shipped is admin tooling: import queues,
 * the statistics dashboard, placement backups, moderator-only filters. To a
 * reader of the list those entries are noise at best — they describe buttons
 * that page does not have — and at worst they advertise the shape of the
 * moderation tools to people who cannot use them.
 *
 * So every line carries its audience. `adm(...)` marks a change as staff-only;
 * a bare string is for everybody. `visibleUpdates()` filters both the lines and
 * the entries, and an entry whose every line is staff-only simply isn't there
 * for a normal reader. Nothing is duplicated and nothing is written twice —
 * there is one history, read at two levels of access.
 */

/** One line of a release. A bare string is public; the object form is staff-only. */
export type SiteChange = string | { text: string; admin: true }

export type SiteUpdate = {
  /** Semantic-ish: major.minor.patch, monotonically increasing down the file. */
  version: string
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  title: string
  /** One line per change. Written for readers of the site, not the diff. */
  changes: SiteChange[]
  /** Optional grouping chips shown next to the entry. */
  tags?: string[]
}

/** Mark a change as staff-only. Short on purpose — it appears a hundred times. */
const adm = (text: string): SiteChange => ({ text, admin: true })

export const SITE_UPDATES: SiteUpdate[] = [
  {
    version: '1.31.0',
    date: '2026-08-16',
    title: 'Accounts are made through Discord',
    tags: ['Accounts', 'Security'],
    changes: [
      'New accounts are created through Discord, and you need to be in the All Levels List server. The password sign-up form is gone.',
      'This is the anti-spam measure. An email address costs a throwaway inbox; being in the server costs an invite, and it can be taken away again.',
      'Nothing changes if you already have an account — your password still signs you in, and you can link Discord from the login page whenever you like.',
      'If you are not in the Discord server, signing up now tells you so, with a link to join. It used to fail silently — the attempt came back to the homepage carrying an error the homepage had no way to show.',
      'There is a Discord button in the header now, next to the theme picker.',
    ],
  },
  {
    version: '1.30.0',
    date: '2026-08-16',
    title: 'Clips bring their own thumbnail and date',
    tags: ['Submissions', 'UI'],
    changes: [
      'An uploaded MP4 fills in its own verification date. The file records when it was made, so asking you to type it was asking for something the clip already knew.',
      'Uploaded clips get a thumbnail. A frame is taken a second in — not the first frame, which on a recording is usually black — and shows anywhere level art would.',
      'Medal.tv clips show their thumbnail too.',
      adm('The site can be closed to everyone but staff from the accounts page, next to the registration switch. Like registration, it used to be an environment variable and a redeploy.'),
    ],
  },
  {
    version: '1.29.0',
    date: '2026-08-16',
    title: 'Bigger clips, and fixes to estimates and thumbnails',
    tags: ['List', 'Submissions', 'UI', 'Fixes'],
    changes: [
      'Fixed challenge estimates showing NLW the wrong way round. NLW means Not List Worthy, so it belongs on estimates past the end of the list — #101 or beyond. A level estimated at #44 was being called unworthy when it would comfortably make the list; it shows ~#44 now.',
      'A level already on a list no longer shows an estimate for that list beside its real placement.',
      'Clicking another list in the rankings panel takes you to that list’s homepage. The links pointed at level pages built from ids and slugs that go stale, so they often led nowhere.',
      'Uploaded clips can be up to 1 GB, up from 64 MB. The upload streams to disk now instead of being held in memory, which is what makes a limit that size safe to offer.',
      'Level thumbnails that fail to load show nothing at all rather than an empty box, and the site now loads at most four YouTube thumbnails at a time. Asking for fifty at once is what was getting the site rate limited on profiles.',
      'Submitting a level from Find a Level fills in the difficulty from the search result.',
      'The "Demon level" field is called Difficulty, since it is also the field for levels that are not demons.',
      adm('Registration can be opened and closed from the accounts page, taking effect immediately. It was an environment variable, so changing it meant a redeploy — not what you want mid-spam-wave.'),
    ],
  },
  {
    version: '1.28.0',
    date: '2026-08-16',
    title: 'Sign in with Discord',
    tags: ['Accounts', 'Security', 'List', 'Fixes'],
    changes: [
      'You can sign in with Discord, if you’re in the All Levels List server. No email, no password, no confirmation link — being in the server is the check. Leave the server and the next sign-in stops working.',
      'Discord accounts can post straight away. The email confirmation exists so an account costs more than a form submission, and a server membership already costs more than that.',
      'Existing accounts can link their Discord from the login page, so you can keep your password or stop using it.',
      'Reading the challenge list, a level now leads with its challenge rank and shows its ALL placement in the badge underneath. It was the other way round, so a level you reached from challenge #12 opened on #4,021. Switching lists from the dropdown swaps them instantly.',
      'Challenge estimates inside the top 100 say NLW instead of a number — the levels either side are too far apart up there for a specific guess to mean much.',
      'Fixed level thumbnails going missing on profiles. A page listing fifty levels asks YouTube for fifty images at once, which sometimes gets rate limited — and the site was recording that as "this video has no thumbnail" and remembering it for a week. It retries now, and only gives up once the retries agree.',
    ],
  },
  {
    version: '1.27.0',
    date: '2026-08-16',
    title: 'Text cleanup, and the GDSR beta is out',
    tags: ['UI', 'Fixes'],
    changes: [
      'Rewrote most of the site\'s text. Menus, hints, empty states and error messages get to the point now instead of explaining themselves.',
      'Rewrote the About page and this changelog the same way.',
      'Pulled the GDSR builder beta. It wasn\'t good enough yet. Nothing else about custom lists changed.',
    ],
  },
  {
    version: '1.26.0',
    date: '2026-08-16',
    title: 'Leaderboard fixes and a big AREDL repair',
    tags: ['Leaderboard', 'Fixes'],
    changes: [
      'Searching the leaderboard keeps real ranks. The first search result used to always show as #1, no matter where that player actually stood.',
      'The podium only shows when there are at least three players to put on it.',
      'Removed the shaded points bar behind leaderboard rows — it only ever highlighted the top few and tinted whatever accent colour you picked.',
      'You can pick a level right on the opinion form. It used to just say "open this page from a level page".',
      adm('Fixed AREDL placements missing for about two thirds of levels. One failed request used to abort the whole import partway. There\'s also a new "AREDL placements" button that refetches every position in a single request.'),
      adm('Pending levels can be sorted newest first.'),
      adm('Import rows link to the list they import, and the ALL Challenges Sheet moved in with the other challenge lists — it\'s community-run, not ours.'),
    ],
  },
  {
    version: '1.25.0',
    date: '2026-08-13',
    title: 'Permanent level links, and nine languages',
    tags: ['List', 'Custom lists', 'Languages', 'UI', 'Fixes'],
    changes: [
      'Permanent links: alllevelslist.com/<level id> opens that level wherever it currently sits, and there\'s a copy button next to the level ID. If two levels share an ID, it asks which one you meant.',
      'The site speaks nine languages, picked from the theme menu. Only the site\'s own text is translated — level names, comments, bios and lists stay as their authors wrote them.',
      'The challenge badge on a level opens the challenge list, and list views are linkable in general — the address remembers which list you\'re reading.',
      'Removed levels show up in the changelog now instead of vanishing without a trace.',
      'Custom lists can hide tiers, difficulties and ALL links. Four presets, and every switch stays editable.',
      'Custom lists can wrap or shrink long level names instead of cutting them off.',
      'The report button is in the same place everywhere and always visible, with a toast confirmation instead of shoving the row sideways.',
      'Fixed the challenge changelog arrows measuring main-list movement instead of challenge-list movement.',
      'Fixed the profile header colliding with the avatar on phones.',
      adm('Role changes and challenge marks can be undone from the activity log. Undoing writes a new entry — the log stays append-only.'),
      adm('Removing a level asks for a reason and records it with the level\'s name, placement and tier.'),
    ],
  },
  {
    version: '1.24.0',
    date: '2026-08-12',
    title: 'The whole list, on a phone',
    tags: ['UI', 'Mobile'],
    changes: [
      'The list actually works on a phone now. Every list page was a fixed three-column desktop layout — at phone width the level list was a sliver of clipped letters.',
      'The side panels are drawers on mobile, and they keep your search and scroll position while closed.',
      'Custom lists used to hide their level list entirely on narrow screens. Fixed.',
      'The bottom of list pages is reachable on phones — about 80px used to sit permanently under the browser bar.',
      'Tapping a search box no longer zooms the whole page in on iOS.',
      adm('The admin panel\'s tab bar is four grouped menus instead of eleven loose controls.'),
      adm('The list helper role can actually be assigned now.'),
      adm('Deleted comments keep their text in the activity log, so reports about them still point at something.'),
    ],
  },
  {
    version: '1.23.0',
    date: '2026-08-12',
    title: 'Accounts that cost something to make',
    tags: ['Accounts', 'Security'],
    changes: [
      'New accounts need a verified email before commenting, submitting or sending friend requests.',
      'Added a captcha to signup and login.',
      'Comments are rate limited, and posting the same comment twice in five minutes counts as a double-click, not a second comment.',
      'Fixed a hole that let scripts run from uploaded avatars — images are checked against what they actually contain now.',
      'Fixed an open redirect on the login page.',
      adm('Added security headers across the site: CSP, frame-ancestors, nosniff, HSTS.'),
    ],
  },
  {
    version: '1.22.0',
    date: '2026-08-12',
    title: 'Reports, and a role for the list',
    tags: ['Moderation', 'Accounts', 'Profiles', 'Fixes'],
    changes: [
      'You can report accounts, comments, custom lists and levels. Reports about staff go to site admins only, never to the person named.',
      'New "list helper" role: can place levels and accept submissions, and files a request for anything bigger.',
      'Your bio has its own editor. The old About panel just repeated the header, so it\'s gone.',
      'Podium view on the leaderboards can be toggled off.',
      'Fixed the list appearing to freeze when moving between menus through the home page.',
      'The credits name Claude AI, and The Shitty List, whose template this site started from.',
      adm('An activity log: every action, who did it, and when. Filterable by area, searchable by name.'),
      adm('A queue for the move requests list helpers file.'),
      adm('Statistics can\'t be inflated by refreshing the page anymore.'),
    ],
  },
  {
    version: '1.21.0',
    date: '2026-08-12',
    title: 'Friends, a forum, and clans you can run',
    tags: ['Community', 'Profiles', 'UI', 'Fixes'],
    changes: [
      'Friends. Send a request from a profile, answer it from your inbox, manage the list from your account page. Following stays one-sided.',
      '"Mutual friends" now means actual friends in common, not people you both happen to follow.',
      'A forum in the community hub. Threads can name a level and show up on that level\'s page.',
      'Clans can finally be edited — name, tag, description, colour and join policy were all locked in at creation before.',
      'Clans can upload a picture and a background.',
      'The clans page sorts by points, levels, members, newest or name, and can filter to clans you can just join.',
      'Invite friends to your clan from a list of them instead of typing names from memory.',
      'A challenge leaderboard, ranked by challenge points.',
      'Custom lists can mark a level as a challenge, independent of what the ALL says.',
      'Clan invites and friend requests can be answered right in your inbox, and the inbox can be filtered and cleared.',
      'Leaderboard pictures fall back to AREDL avatars for players who never signed up here. Your own picture always wins.',
      'Levels submitted from a custom list no longer stall on a missing verification date — it\'s read from the video.',
      'Advanced search stopped rebuilding the list behind the dialog on every filter change.',
      'The site has a real logo. The old one was a smudge at browser-tab size.',
      'View counts moved off the list rows and live on level pages.',
      'Rebuilt the profile-picture cropper — what you save is what the preview showed.',
      'The default accent colour is cyan.',
      'The About page credits every API the site reads, AREDL first.',
      adm('Challenge marks refresh the challenge leaderboard immediately.'),
      adm('Forum threads can be pinned, locked and deleted by moderators.'),
    ],
  },
  {
    version: '1.20.0',
    date: '2026-08-12',
    title: 'View counts, and charts worth reading',
    tags: ['List', 'Admin', 'UI'],
    changes: [
      'Every level shows how many times it\'s been opened — the one number on a level that comes from readers rather than curators.',
      adm('The by-hour panel is a real chart: an axis, gridlines, and hover values.'),
      adm('It counts people as well as views. Forty pages by one reader is forty views and one person.'),
      adm('Today\'s chart shows the typical day behind it as a dashed line.'),
      adm('Chart gridlines use even steps. They used to read 5, 4, 3, 1, 0.'),
      adm('npm run reset-analytics starts the counters over — the old numbers were inflated by double counting.'),
    ],
  },
  {
    version: '1.19.1',
    date: '2026-08-12',
    title: 'Small fixes',
    tags: ['Admin', 'UI', 'Fixes'],
    changes: [
      'The Submit menu\'s record icon is a medal, not a flag. A flag reads as "report this".',
      'Fixed the double space in "2  views" on profiles.',
      adm('Imported levels and real submissions are separate lines in statistics. A big import used to bury every submission ever made.'),
      adm('Admins get an inbox notice when someone\'s role changes: who, whom, from what.'),
    ],
  },
  {
    version: '1.19.0',
    date: '2026-08-12',
    title: 'Statistics you can trust',
    tags: ['Admin', 'Access', 'Fixes'],
    changes: [
      'Custom lists show how many times they\'ve been opened. Your own visits to your own list don\'t count.',
      'Profile and level view counts show from the very first view.',
      adm('The view counter can\'t be spammed anymore: repeat views within 15 seconds don\'t count, and no single reader can add more than a couple thousand views a day.'),
      adm('Every arrival was being counted twice — redirect plus page. Only delivered pages count now, and 404s don\'t count at all.'),
      adm('Flicking through admin tabs no longer counts as fifteen page views.'),
      adm('Views and unique visitors are separate figures everywhere, with the ratio shown.'),
      adm('Statistics shows views by the hour, with the busiest hour called out.'),
      adm('Statistics shows how many accounts were signed in each day.'),
      adm('The charts have real axes, gridlines, dates and hover readouts.'),
      adm('"Most-viewed levels" respects the selected range. All-time is its own option.'),
      adm('"Accounts with records" counts accepted records only.'),
    ],
  },
  {
    version: '1.18.0',
    date: '2026-08-10',
    title: 'A header that fits a phone',
    tags: ['UI', 'Access', 'Fixes'],
    changes: [
      'The site header works on a phone. It used to be a 550px row inside a 343px screen, horizontal scrollbar included. There\'s a menu button and a drawer now.',
      'Both navigations are built from one list, so the drawer can never be missing a page the dropdowns have.',
      'One card, one dropdown, one button, one input. Dozens of hand-written variants — ten primary button sizes, 228 hand-made form fields — collapsed into shared controls.',
      'The view switcher is one control now, and it tells screen readers which option is selected.',
      'The leaderboard\'s search box matches the rest of the site, and its page arrows are big enough to tap.',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-08-10',
    title: 'Clan invites, and video dates again',
    tags: ['Community', 'Profiles', 'UI', 'Fixes'],
    changes: [
      'Clans can invite people. Invites show on the clans page and in your inbox, and get you into invite-only clans without asking first.',
      'Verification dates read from a video\'s upload date work again — the API key was never configured, so every lookup quietly came back empty.',
      'That lookup needs a session now, caches results, and says when it isn\'t configured.',
      'Location, pronouns and join date are chips with icons instead of one run of grey text.',
      'Badges are optically centred, and role badges carry a dot of their own colour.',
      'Clan tags lost their border — a soft block of the clan\'s colour instead of a box in front of every name.',
      'Progress posts draw as bars, and no longer load a YouTube player each whether you wanted one or not.',
      'The About page opens with the numbers people come to it for.',
      adm('Fixed "Between" running straight into the level name in the pending queue.'),
    ],
  },
  {
    version: '1.16.0',
    date: '2026-08-09',
    title: 'Clan tags everywhere',
    tags: ['Community', 'Profiles', 'UI', 'Submissions'],
    changes: [
      'Your clan tag shows beside your name wherever your name appears, not just on the clans page.',
      'Clan tags look the way the community writes them: brackets and the clan\'s own colour.',
      'Every badge on the site comes from one definition now. They\'d drifted into four sizes and five paddings.',
      'A level\'s records sort by the record, not by which list happened to be imported first. A 60% used to sit above a verified 100%.',
      'Record rows link the player, show a real flag, and mark verifications and mobile runs.',
      'The profile header prints your country once, not twice.',
      'Every box on a profile is the same box.',
      '"Of the list" draws its share as a bar under the number.',
      'Ticking Challenge on the submit form compares against challenges only, ranked among themselves.',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-08-08',
    title: 'Clans, and a much faster list',
    tags: ['Community', 'The list', 'Performance', 'Fixes'],
    changes: [
      'Clans: groups of players ranked by what they\'ve beaten between them. Points count each level once, so a clan climbs by covering more of the list.',
      'Browsing the list went from 131ms a page to 6ms. It was rebuilding the entire challenge ranking on every request.',
      'Fixed a slow search filter — 12× faster, same answers.',
      'Advanced search shows active filters as chips you can remove one at a time, and counts matches live.',
      'The builder\'s palette scrolls through the whole list instead of stopping at the first sixty levels.',
      '"All demonlists used" shows when each list was last refreshed, and sorts by size, overlap or freshness.',
      'Your profile shows what percent of the list you\'ve beaten.',
      'Long Discord changelogs split across messages instead of being cut off.',
      'Fixed "Challenges" truncating to "Ch…" in the profile chart.',
      adm('The pending queue only renders the rows you can see, not all fourteen hundred.'),
    ],
  },
  {
    version: '1.14.0',
    date: '2026-08-08',
    title: 'Profiles, and how much the site is read',
    tags: ['Profiles', 'Admin', 'The list'],
    changes: [
      'Your profile and your account page are the same page now. They were two hand-written copies that had drifted apart.',
      'The edit form is four labelled groups instead of fourteen boxes in a row.',
      'Profiles can link Twitch, X and Bluesky alongside YouTube, Discord and GD. Each link is checked against the site it claims to be.',
      'A profile says when someone follows you back, and how many times it\'s been opened.',
      'Level pages show their view count.',
      'The about page shows how many pages have been read on the site.',
      adm('New Statistics tab: traffic, visitors, most-read pages, most-viewed levels, and growth over any window up to a year. No per-visitor records behind any of it.'),
    ],
  },
  {
    version: '1.13.0',
    date: '2026-08-04',
    title: 'Country flags, and a levels-vs-challenges split',
    tags: ['Profiles', 'The list', 'Fixes'],
    changes: [
      'Pick your country from a list and its flag sits beside your name. It was a free-text box where "UK" and "england" were different countries.',
      'Your profile splits what you\'ve beaten into levels and challenges, as a ring.',
      'Role badges are one shape everywhere and explain the role on hover.',
      'Fixed Owner and Admin badges being the same colour. Admin is violet now.',
      'The Global Demonlist is demonlist.org, not gdladder.com.',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-08-04',
    title: 'One move, one changelog entry',
    tags: ['The list', 'Custom lists', 'Performance', 'Fixes'],
    changes: [
      'Fixed moving a level writing a changelog entry for every level it passed. Promote something 400 places and the day read as 401 moves.',
      'Custom list colours are a real control — nine presets or any hex — and apply on every page of the list.',
      'Levels show where their placement came from as linked chips per list, instead of "AREDL|ACS" after the word Source.',
      'The builder page is a header and the builder, not a full-screen hero with a collapse button.',
      'Levels without HD thumbnails are remembered, so pages stop re-asking YouTube on every visit.',
      'Showcase cards stop loading 1920px images to paint 350px cards.',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-08-04',
    title: 'The list name is a menu',
    tags: ['Imports', 'Admin', 'Custom lists', 'The list', 'Fixes'],
    changes: [
      'The list name at the top is a dropdown: Classic, Challenge, Rated, and the three external rankings. They were radio buttons hidden in advanced search.',
      'The level count next to it opens the stats page.',
      'The ACS is no longer listed among a level\'s other rankings — it\'s this project\'s own sheet, so that was the ALL citing itself.',
      'Custom list credits read as a sentence again, and the creator\'s name filters the list.',
      'Fixed custom-list submissions being tiered by the wrong formula — off by up to ten tiers.',
      'Fixed names in comments not actually being links.',
      adm('ACS imports bring each level\'s verification video — 928 of them were invisible to the text export.'),
      adm('The ACS is in Imported Movements like every other list.'),
      adm('Imported levels say which two levels their estimated placement lands between.'),
    ],
  },
  {
    version: '1.10.0',
    date: '2026-08-04',
    title: 'Profiles in tabs, clearer forms',
    tags: ['Admin', 'Profiles', 'Custom lists', 'Submissions', 'Fixes'],
    changes: [
      'A profile\'s Completed, Verified and Created levels are one card with tabs, a filter box, and 25 rows at a time.',
      'Profile comments are a proper section with avatars and name decorations.',
      'Custom lists: the buttons say "Submit Level" and "Submit Record" instead of "Suggest" and "Submit".',
      'List headers wrap properly on narrow screens, and Editors is on every page of a list.',
      'Credits are labelled, instead of one grey line reading "by X · verified by X".',
      'A list in standalone mode doesn\'t offer the Builder button.',
      'The level submit form is five titled sections, and the submit bar names the first thing still missing.',
      'Fixed profile comments arriving as "Comments 0" and filling in late.',
      'Fixed the rating tile using outdated challenge rules.',
      'Fixed profile lists numbering rows by internal position instead of placement.',
      adm('A level can be marked as a challenge in one click, from its page.'),
    ],
  },
  {
    version: '1.9.0',
    date: '2026-08-03',
    title: 'Tiers on custom lists',
    tags: ['Imports', 'Profiles', 'Custom lists', 'Fixes'],
    changes: [
      'Custom lists can be split into named tiers. A tier runs until the next one starts, so the bands follow the list as levels move.',
      'Fixed saving your profile erroring if you didn\'t touch your GD username.',
      'Fixed list settings arriving blank from the server and filling in late.',
      adm('ACS levels reach the imported queue with their own filter chip — 262 were sitting in the wrong queue.'),
      adm('Admins can use a custom profile background.'),
      adm('Admins can add an emoji and a badge beside their name.'),
    ],
  },
  {
    version: '1.8.0',
    date: '2026-08-03',
    title: 'The challenges sheet',
    tags: ['Imports', 'Admin', 'Challenges', 'Fixes'],
    changes: [
      'Fixed unmarking a challenge not actually taking it off the challenge list.',
      adm('The ALL Challenges List sheet is an import source: 940 challenges, 258 already on the ALL with an ACS badge, the rest queued with estimated placements.'),
      adm('Remove sits next to Edit on a level, instead of at the bottom of an edit form.'),
      adm('A level can be taken off the challenge list, and put back.'),
    ],
  },
  {
    version: '1.7.0',
    date: '2026-08-03',
    title: 'Estimates that follow the list',
    tags: ['Custom lists', 'Admin', 'Leaderboard', 'UI', 'Fixes'],
    changes: [
      'Placement estimates follow the list\'s real shape instead of spacing rows evenly. Worst case went from thirteen tiers off to about two.',
      'Clicking a leaderboard player opens their profile here, not their AREDL page.',
      'Custom lists show who runs them, on every page.',
      'Custom lists gained presentation settings — banner, level art, points, density — and the accent colour themes the whole list.',
      'A Builder button in every list header. It was three clicks deep in a settings page about webhooks.',
      'List settings split into five sections.',
      '"Lists used" shows how much of each mirrored list the ALL already carries.',
      'Fixed the editor roster missing from server-rendered pages.',
      adm('The Discord tab is grouped by what each webhook posts.'),
      adm('Webhook URLs are masked in the admin panel.'),
    ],
  },
  {
    version: '1.6.1',
    date: '2026-08-03',
    title: 'Badges for other lists',
    tags: ['List', 'Profiles', 'Submissions', 'Fixes'],
    changes: [
      'Levels carry badges for the other lists that rank them — CH #17, CCL #1, AREDL #4 — two at most, with a +N opening the full set.',
      '"Rankings on other lists" rows are links end to end.',
      'The challenge badge says "Challenge #12" once, instead of "Challenge" and then "Ch. #12".',
      'Picking a tier on the submit form fills in a placement from the middle of that tier. It stays editable.',
      'New profile link: your GD username, going to gdbrowser.',
      'Followers and Following are clickable and open the full list, not just the first 24.',
      'Level IDs link to gdbrowser everywhere they appear.',
      'Fixed GD usernames over 20 characters being silently cut down and saved as somebody else\'s name.',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-08-03',
    title: 'Moves carry the tier, claims carry the records',
    tags: ['List', 'Profiles', 'Custom lists', 'Fixes'],
    changes: [
      'Moving a level sets its tier to the one it lands in. Both move tools say what the tier will become, and offer to keep the old one.',
      'Claiming an AREDL, GDL or Pointercrate player brings their records onto your profile.',
      'You can unclaim, and admins can too. The imported records leave with the claim; your own submissions never do.',
      'A button to re-import records from claims made before this existed.',
      'Tiers go up to 45 now, and the next raise is a one-line change.',
      'A custom list can be its own ranking, with rank colours scaled to itself.',
      'Custom lists can override a level\'s video, name, creator or tier, and clear the override to follow the ALL again.',
      'Standalone links for lists: no site header or footer, one button back. For pinning in a Discord.',
      'Fixed the leaderboard showing the wrong picture, or none.',
      'Fixed community tiers never appearing on level pages.',
      'The account page stopped repeating the Submit buttons the header already has.',
      adm('Placement backups carry tiers, so restoring one restores those too.'),
    ],
  },
  {
    version: '1.5.0',
    date: '2026-08-02',
    title: 'Imports you can watch',
    tags: ['Admin', 'Imports', 'UI', 'Fixes'],
    changes: [
      'Every imported list is on About → Lists used automatically, with how much of it the ALL shares.',
      'The List menu links straight to the ALL sheet.',
      'Submit a level shows the level\'s art once you type an ID, and the checklist chips jump to the field they name.',
      'Submit a record shows the level you picked, so the wrong variant is visible before you send it.',
      'The builder\'s intro stays collapsed once you collapse it.',
      adm('Imports show a real progress bar with the phase and count.'),
      adm('A site-owned level can be handed back to the sheet, which owns it from then on.'),
      adm('Imported moves suggest the smallest move that satisfies the other list, and name the two levels either side.'),
      adm('"Site-only levels" is a moderator filter now.'),
      adm('Pending queue: readiness dots, named gaps, j/k to walk the queue.'),
    ],
  },
  {
    version: '1.4.1',
    date: '2026-08-02',
    title: 'Sharper backgrounds, and a profanity filter',
    tags: ['UI', 'Custom lists', 'Moderation', 'Fixes'],
    changes: [
      'Level backgrounds come in the size the screen actually needs. Phones stop downloading a megabyte to paint a card.',
      'Profanity is refused where it becomes part of the site: usernames, list titles, pack names, notes, player names, comments.',
      'The filter reads through the usual dodges while leaving Scunthorpe, assassin and Uranus alone.',
      'New list setting: records don\'t need a video link. Off by default.',
      'Fixed one- and two-player list leaderboards showing "No players match" and nothing else.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-08-02',
    title: 'Placement backups, and our own history',
    tags: ['Admin', 'Changelog', 'Community', 'Fixes'],
    changes: [
      'The changelog is the ALL\'s own history again. 1,774 of its 1,777 entries were imported AREDL movements about another site\'s list.',
      'Level graphs plot the ALL\'s history alongside AREDL\'s, each on its own scale.',
      'Community search covers members, the ALL, AREDL, Pointercrate and GDL at once.',
      'Fixed placement estimates collapsing onto one answer for whole stretches of the list.',
      'Fixed custom-list submissions arriving with no verification date.',
      'Fixed custom-list submissions arriving with no placement estimate.',
      'Fixed the bulk submit page briefly claiming every level was already on the ALL.',
      adm('Placements download as an editable CSV and upload back — to undo, or to move levels from a spreadsheet.'),
      adm('"Reset to the sheet\'s order" without re-downloading the sheet. Site-only levels hold their positions.'),
      adm('Both preview before moving anything, and back up the current placements first.'),
      adm('New Imported moves tab: levels ranked differently by an imported list, with one button to move each.'),
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-01',
    title: 'Closed for testing',
    tags: ['Access', 'Admin'],
    changes: [
      'The site is restricted to the team while the list and the website settle.',
      'Account creation is closed. Existing accounts still sign in.',
      'Signed-in accounts without access get an explanation instead of a login loop.',
      adm('Admin accounts can be created from the command line — also the way back in if the last one is lost.'),
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-01',
    title: 'About, profiles and the admin panel',
    tags: ['Profiles', 'Admin', 'UI', 'Fixes'],
    changes: [
      'About & stats rebuilt: three tabs, real charts, and new numbers — records, players, coverage, skillsets, hardest level.',
      'Your account page is the profile you\'re editing, updating live as you change it.',
      'Pick any level on the list as your profile banner. No record required.',
      'Fixed words running together in the Following feed ("GERGcompletedSociety").',
      'Fixed the settings form forgetting your banner and pinned completion.',
      'Public lists are called Custom lists, and there\'s a My lists view including unpublished ones.',
      'The footer credits everyone who built the site.',
      adm('Fixed the admin Pending menu opening behind the page.'),
      adm('A downloadable report of everywhere the sheet and the site disagree.'),
      adm('"Site only" actually means the sheet has no level with that ID.'),
      adm('Level queues got art, tier colours and readable layouts.'),
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-01',
    title: 'Custom lists feed the ALL',
    tags: ['Custom lists', 'Submissions', 'Fixes'],
    changes: [
      'New "To the ALL" tab on custom lists: submit as many levels as you like at once, with each row saying what it still needs.',
      'Submissions from a list arrive with a tier and placement estimated from their neighbours already on the ALL.',
      'A list can follow ALL ordering and keep up as the ALL changes. Your hand-made order is kept for when you switch back.',
      'Fixed avatars showing black corners on profiles.',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-08-01',
    title: 'Placements that actually move',
    tags: ['Fixes', 'Custom lists', 'Profiles'],
    changes: [
      'Fixed moving a level leaving its old placement printed and shifting every other level by one. Placement numbers belong to the slot now.',
      'Lists damaged by that bug repair themselves on the next start.',
      'Custom-list rows link themselves to the matching ALL level when it\'s unambiguous. Editors can link or unlink by hand.',
      '"Submit to the ALL" on custom-list levels opens the submit form prefilled.',
      'Rebuilt the cropper: bigger stage, pinch and drag, cursor zoom, arrow keys.',
      'Fixed black corners on square avatars.',
      'Roomier type in the Following feed.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-31',
    title: 'Profiles, custom lists and a version number',
    tags: ['Profiles', 'Custom lists', 'UI', 'Performance'],
    changes: [
      'Profiles rebuilt around a cover image — a hardest completion or a favourite level paints your header.',
      'Pick a hardest completion and it headlines your profile with percent, points and proof.',
      'The community hub is a proper feed with avatars, level art and filters.',
      'Custom lists have an in-list editor: drag to reorder, type a rank, edit in place.',
      'Custom-list rows match the main list, so the two read as one site.',
      'List leaderboards: podium, bars, avatars, search, per-player breakdowns.',
      'The player leaderboard pages instantly instead of rebuilding per page.',
      'Faster level moves: nudges, drag-to-place, and a "move now" that skips the rest of the form.',
      'The changelog groups by day, with movement distances and level art.',
      'Header dropdowns have icons, sections and arrow-key navigation.',
      'Faster all round: fewer fonts, cached data, pre-compressed assets, new indexes.',
      'This page, and a version number in the footer.',
      adm('"Create a custom list" can pull from any imported list, not just the ALL.'),
    ],
  },
  {
    version: '0.9.0',
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
export const SITE_VERSION: string = SITE_UPDATES[0]?.version ?? '0.9.0'

/** The date of the newest entry, used for the "new updates" dot. */
export const SITE_VERSION_DATE: string = SITE_UPDATES[0]?.date ?? ''

/**
 * How a version is written wherever a reader sees one.
 *
 * The site is in beta, and a bare `v1.21.0` claims otherwise — a 1.x version
 * number is the conventional way of saying "this is released". Written in one
 * place because it appears in the footer, the header menu, the About hero and
 * twice on the Updates page, and five copies of a format string is five things
 * to find when it changes.
 */
export function versionLabel(version: string): string {
  return `Beta ${version}`
}

/** The words of a change, whichever form it was written in. */
export function changeText(change: SiteChange): string {
  return typeof change === 'string' ? change : change.text
}

/** Whether a change is staff-only. */
export function isAdminChange(change: SiteChange): boolean {
  return typeof change !== 'string' && change.admin === true
}

/**
 * The changelog as a given reader should see it.
 *
 * Staff see everything. Everybody else sees the lines written for them, and
 * entries left with nothing at all are dropped rather than rendered as a title
 * with an empty body — a release that was purely internal is not a release
 * anybody outside the team can be told about.
 *
 * The `Admin` tag goes with the lines it describes, so a filtered entry doesn't
 * advertise a category none of its visible content belongs to.
 */
export function visibleUpdates(isAdmin: boolean): SiteUpdate[] {
  if (isAdmin) return SITE_UPDATES
  const out: SiteUpdate[] = []
  for (const u of SITE_UPDATES) {
    const changes = u.changes.filter((c) => !isAdminChange(c))
    if (!changes.length) continue
    out.push({
      ...u,
      changes,
      tags: u.tags?.filter((t) => t !== 'Admin' && t !== 'Imports' && t !== 'Moderation'),
    })
  }
  return out
}

/**
 * The About page's own words.
 *
 * The intro and the FAQ used to come out of the same Google Sheet as the list
 * data, one paragraph per row, which meant the page describing the site could
 * change under it without anyone touching the site. Copy that explains what the
 * All Levels List is belongs with the site, so it lives here: version-controlled,
 * reviewable, and structured as questions and answers rather than as prose that
 * has to be split back apart at render time.
 *
 * The sheet still owns the Stats Viewer FAQ and the list of demonlists used.
 */

/** The hero paragraphs, in order. */
export const ABOUT_INTRO: string[] = [
  'The All Levels List ranks pretty much every Geometry Dash level, hardest first. It starts with the extreme demons at the top and keeps going all the way down to the easiest levels in the game.',
  'Placements are worked out by the community. The list pulls rankings from a lot of other demonlists and merges them into one order, and every level carries a tier taken from community difficulty ratings. Tiers run Subtier 0 through Subtier 5, then Tier 1 upward.',
  'Players send in their clears as well. Approved records show up on your profile and build the leaderboard.',
]

export type AboutFaqEntry = { question: string; answer: string }

/** The "How the list works" section. One question per entry, answered and done. */
export const ABOUT_FAQ: AboutFaqEntry[] = [
  {
    question: 'How does a level get placed?',
    answer: 'Most placements come from the other demonlists this site mirrors, merged into a single order. Anything those lists don\'t cover is placed by hand, against the levels sitting either side of it.',
  },
  {
    question: 'What do the tiers mean?',
    answer: 'A tier is how hard the community reckons a level is, not what the game says. They go Subtier 0 to Subtier 5 and then Tier 1 upward, easiest to hardest.',
  },
  {
    question: 'How do I submit a level?',
    answer: 'Use the level submission form and give it a rough placement or tier if you have one. A moderator looks at it before it goes on the list.',
  },
  {
    question: 'How do I submit a record?',
    answer: 'Use the record submission form and include a video of the clear. Once it\'s approved it counts on your profile and on the leaderboard.',
  },
  {
    question: 'A level is missing. What do I do?',
    answer: 'Submit it. The list is big but it was never finished, and a missing level usually just means nobody has sent it in yet.',
  },
  {
    question: 'What is the void list?',
    answer: 'Levels that were submitted without any difficulty opinion attached. They wait there until someone rates them, and then they get reviewed for the main list like any other submission.',
  },
  {
    question: 'How are records verified?',
    answer: 'Every record needs a video link showing the clear. A moderator watches it and either approves the record or rejects it.',
  },
  {
    question: 'Do I need an account?',
    answer: 'Not for reading the list. You need one to submit a level or a record. Sign up with an email and confirm it, or sign in with Discord if you\'re in the server.',
  },
]

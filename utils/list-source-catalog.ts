/**
 * Every list this site imports, in one place.
 *
 * Kept in `utils/` rather than `server/utils/` because three things read it:
 * the server validates a `source` against it, the admin's "build a list from"
 * picker renders from it, and the public "Lists used" page enumerates it. That
 * last one is why the URLs live here — the page used to show only what the
 * sheet's own "All Demonlists Used" section happened to name, so a list this
 * site actively mirrors could be missing from the page that claims to list
 * them. Adding an importer now adds it to that page by construction.
 *
 * The queries themselves live in `server/utils/list-sources.ts`.
 */
export type ListSource = {
  key: string
  label: string
  /** One-line description shown under the picker. */
  hint: string
  /** Only the ALL list carries the tier / rating data those filters need. */
  supportsFilters: boolean
  /** Where a reader goes to see the list itself. */
  url?: string
}

/**
 * GDListTemplate-backed lists all live in `gdtpl_levels`, keyed by `list_slug`.
 * Adding a newly imported one is a line here.
 */
const GDTPL_LISTS: { slug: string; label: string; hint: string; url: string }[] = [
  { slug: 'ccl', label: 'CCL — Consistency Challenge List', hint: 'consistencychallenge.pages.dev', url: 'https://consistencychallenge.pages.dev' },
  { slug: 'tsl', label: 'TSL — The Shitty List', hint: 'tslplus.pages.dev', url: 'https://tslplus.pages.dev' },
  { slug: 'edi', label: 'EDI — Extreme Demon Index', hint: 'edi-d6y.pages.dev', url: 'https://edi-d6y.pages.dev' },
  { slug: 'ddl', label: 'DDL — Denouement Demonlist', hint: 'denouementdl.vercel.app', url: 'https://denouementdl.vercel.app' },
  { slug: 'll',  label: 'LL — Layout List',  hint: 'laylist.pages.dev', url: 'https://laylist.pages.dev' },
  { slug: 'tcl', label: 'TCL — Tiny Challenge List', hint: 'tinychallengelist.pages.dev', url: 'https://tinychallengelist.pages.dev' },
  { slug: 'sfl', label: 'SFL — Straight Fly List', hint: 'straightfly.pages.dev', url: 'https://straightfly.pages.dev' },
  { slug: 'cl',  label: 'CL — Challenge List', hint: 'challengelist.gd', url: 'https://challengelist.gd' },
]

/** The ALL Challenges List sheet — the challenge counterpart to the main sheet. */
export const ACS_SHEET_ID = '1tl3_d5vCMIAFxHZU-2prqw7hp9-DyFC_eDzS75tVi0U'

export const LIST_SOURCES: ListSource[] = [
  { key: 'all', label: 'ALL — the main list', hint: 'Placements as shown on the sheet', supportsFilters: true },
  { key: 'aredl', label: 'AREDL — All Rated Extreme Demons', hint: 'aredl.net', supportsFilters: false, url: 'https://aredl.net' },
  // demonlist.org, not gdladder.com: the Global Demonlist moved, and the
  // importer has been reading `api.demonlist.org` all along — only the places
  // that *say* where it lives were still pointing at the old domain.
  { key: 'gdl', label: 'GDL — Global Demonlist', hint: 'demonlist.org', supportsFilters: false, url: 'https://demonlist.org' },
  { key: 'mscl', label: 'MSCL — Super Challenge List', hint: 'mscl.dev', supportsFilters: false, url: 'https://mscl.dev' },
  {
    key: 'acs',
    label: 'ACS — ALL Challenges Sheet',
    hint: 'The project’s own challenge sheet',
    supportsFilters: false,
    url: `https://docs.google.com/spreadsheets/d/${ACS_SHEET_ID}/`,
  },
  ...GDTPL_LISTS.map((g) => ({
    key: `gdtpl:${g.slug}`,
    label: g.label,
    hint: g.hint,
    supportsFilters: false,
    url: g.url,
  })),
]

/**
 * Sources that feed the site but aren't lists you can build from.
 *
 * Pointercrate ranks demons and the Global Stats Viewer supplies records —
 * neither belongs in the "build a custom list from" picker, and both belong on
 * the page that says where the site's data comes from. Kept separate rather
 * than flagged inside `LIST_SOURCES` so nothing that validates a builder source
 * against that array has to learn about them.
 */
export const DATA_SOURCES: { key: string; label: string; hint: string; url: string }[] = [
  { key: 'pointercrate', label: 'Pointercrate — Demonlist', hint: 'Placements and records', url: 'https://pointercrate.com' },
  { key: 'gsv', label: 'Global Stats Viewer', hint: 'Player records across lists', url: 'https://globalstatsviewer.com' },
]

export function findListSource(key: string): ListSource | undefined {
  return LIST_SOURCES.find((s) => s.key === key)
}

/**
 * The site a free-text source *name* refers to, when this catalogue knows it.
 *
 * `levels.placement_source` is whatever the sheet or an admin typed — "EDI",
 * "Challenge List", "LoERL" — not a key. Matching is deliberately exact against
 * a catalogue entry's short name ("EDI") or its full one ("Challenge List"),
 * ignoring case and punctuation, and returns null otherwise: a level's source
 * chip linking to the wrong list is worse than one that doesn't link at all,
 * and plenty of the names on the sheet belong to lists this site never mirrors.
 */
export function sourceUrlByName(name: string | null | undefined): string | null {
  if (!name) return null
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const n = norm(name)
  if (!n) return null
  for (const s of LIST_SOURCES) {
    if (!s.url) continue
    const [short, full] = s.label.split(' — ')
    if (norm(short ?? '') === n) return s.url
    if (full && norm(full) === n) return s.url
    if (norm(s.label) === n) return s.url
  }
  return null
}

export function isKnownSource(key: string): boolean {
  return !!findListSource(key)
}

export function sourceLabel(key: string): string {
  return findListSource(key)?.label ?? key
}

/** Short form for a generated list title — "CCL" out of "CCL — Consistency…". */
export function sourceShortLabel(key: string): string {
  return sourceLabel(key).split(' — ')[0]!
}
